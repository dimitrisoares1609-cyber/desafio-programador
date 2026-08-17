import express from 'express';
import multer from 'multer';
import { config } from '../config';
import { fila } from '../fila/fila';
import * as store from '../armazenamento/store';
import { processar } from '../pipeline/processar';
import { montarTabela } from '../planilha/tabela';
import { FORMATOS, renderizar, type Formato } from '../planilha/render';
import { respostaApi, type Transcricao } from '../tipos';
import { pareceUmPdf, tipoValido, valuePlausivel } from './validacao';

/** O contrato abaixo é literal. */
export const rotas = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxUploadMb * 1024 * 1024,
    files: 1,
    fields: 5,
  },
});

rotas.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, fila: fila.tamanho });
});

// ---------- POST /api/transcricoes ----------

rotas.post('/api/transcricoes', (req, res) => {
  upload.single('arquivo')(req, res, async (erroUpload: unknown) => {
    if (erroUpload) {
      const codigo = (erroUpload as { code?: string }).code;
      if (codigo === 'LIMIT_FILE_SIZE') {
        return res
          .status(413)
          .json({ erro: `Arquivo acima do limite de ${config.maxUploadMb} MB` });
      }
      return res.status(400).json({ erro: 'Upload inválido' });
    }

    const tipo = req.body?.tipo;
    if (!tipoValido(tipo)) {
      return res
        .status(400)
        .json({ erro: 'Campo "tipo" deve ser "cartao-ponto" ou "holerite"' });
    }
    if (!req.file) {
      return res.status(400).json({ erro: 'Campo "arquivo" é obrigatório' });
    }
    if (!pareceUmPdf(req.file.buffer)) {
      return res.status(400).json({ erro: 'O arquivo enviado não é um PDF' });
    }

    const id = store.novoId();
    const caminhoPdf = await store.salvarPdf(id, req.file.buffer);
    const transcricao: Transcricao = {
      id,
      tipo,
      status: 'processando',
      erro: null,
      value: null,
      caminhoPdf,
      criadoEm: Date.now(),
    };
    await store.gravar(transcricao);

    // 202 sai AGORA.
    fila.enfileirar(() => processar(id));

    res.status(202).json({ id });
  });
});

// ---------- GET /api/transcricoes/:id ----------

rotas.get('/api/transcricoes/:id', async (req, res) => {
  const t = await store.ler(req.params.id);
  if (!t) return res.status(404).json({ erro: 'Transcrição não encontrada' });
  res.status(200).json(respostaApi(t));
});

// ---------- PUT /api/transcricoes/:id ----------

rotas.put('/api/transcricoes/:id', express.json({ limit: '10mb' }), async (req, res) => {
  const t = await store.ler(req.params.id);
  if (!t) return res.status(404).json({ erro: 'Transcrição não encontrada' });

  const value = req.body?.value;
  if (!valuePlausivel(t.tipo, value)) {
    return res
      .status(400)
      .json({ erro: 'Corpo deve ser { "value": { "pages": [...] } } no formato do tipo' });
  }

  const atualizado: Transcricao = { ...t, value, status: 'concluido', erro: null };
  await store.gravar(atualizado);
  res.status(200).json(respostaApi(atualizado));
});

// ---------- Endpoints da interface ---------- Fora do contrato obrigatório, que...

rotas.get('/api/transcricoes/:id/tabela', async (req, res) => {
  const t = await store.ler(req.params.id);
  if (!t) return res.status(404).json({ erro: 'Transcrição não encontrada' });
  if (t.status !== 'concluido' || !t.value) {
    return res.status(409).json({ erro: `Status atual: ${t.status}` });
  }
  const tabela = montarTabela(t.tipo, t.value);
  res.status(200).json({
    tipo: t.tipo,
    colunas: tabela.colunas,
    linhas: tabela.linhas,
    refs: tabela.refs,
    avisos: [...tabela.avisos.entries()].map(([linha, aviso]) => ({
      linha,
      severidade: aviso.severidade,
      motivo: aviso.motivo,
    })),
    value: t.value,
  });
});

rotas.get('/api/transcricoes/:id/pdf', async (req, res) => {
  const t = await store.ler(req.params.id);
  if (!t?.caminhoPdf) return res.status(404).json({ erro: 'PDF não encontrado' });
  // inline, não attachment: o visualizador fica ao lado da tabela.
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline');
  res.sendFile(t.caminhoPdf);
});

// ---------- GET /api/transcricoes/:id/planilha ----------

rotas.get('/api/transcricoes/:id/planilha', async (req, res) => {
  const t = await store.ler(req.params.id);
  if (!t) return res.status(404).json({ erro: 'Transcrição não encontrada' });
  if (t.status !== 'concluido' || !t.value) {
    return res
      .status(409)
      .json({ erro: `Transcrição ainda não concluída (status: ${t.status})` });
  }

  const formato = (req.query.formato ?? 'xlsx') as Formato;
  if (!FORMATOS.includes(formato)) {
    return res
      .status(400)
      .json({ erro: `Formato deve ser um de: ${FORMATOS.join(', ')}` });
  }

  // Monta a partir do value ATUAL, que já inclui as correções feitas no PUT.
  const tabela = montarTabela(t.tipo, t.value);
  const { buffer, contentType, extensao } = await renderizar(tabela, formato);

  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${t.tipo}-${t.id}.${extensao}"`,
  );
  res.status(200).send(buffer);
});
