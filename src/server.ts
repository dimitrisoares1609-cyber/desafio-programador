import express from 'express';
import path from 'node:path';
import { config } from './config';
import { rotas } from './api/rotas';
import * as store from './armazenamento/store';

async function main(): Promise<void> {
  await store.iniciar();
  store.agendarLimpeza();

  const app = express();
  app.disable('x-powered-by');

  // Log sem PII: método, rota e status.
  app.use((req, res, next) => {
    const inicio = Date.now();
    res.on('finish', () => {
      const rota = req.path.replace(/\/[A-Za-z0-9_-]{8,}/g, '/:id');
      console.log(`${req.method} ${rota} ${res.statusCode} ${Date.now() - inicio}ms`);
    });
    next();
  });

  app.use(rotas);
  // __dirname é dist/src depois do build, então a raiz do projeto fica dois níveis...
  app.use(express.static(path.resolve(__dirname, '..', '..', 'public')));

  app.listen(config.porta, () => {
    console.log(`ouvindo na porta ${config.porta}`);
    console.log(
      `retenção: ${config.retencaoHoras}h | upload máx: ${config.maxUploadMb}MB | concorrência: ${config.concorrencia}`,
    );
  });
}

main().catch((e) => {
  console.error('falha ao subir:', e);
  process.exit(1);
});
