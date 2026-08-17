// Regenera as planilhas .xlsx de saidas/ a partir dos PDFs de exemplos/.
// Uso: node scripts/gerar-saidas.js [nome-sem-extensao ...]
//   sem argumentos, tenta todos os exemplos. Roda "npm run build" antes.
const fs = require('node:fs');
const path = require('node:path');
const { extrairPaginas } = require('../dist/src/pipeline/paginas');
const { extratorPara } = require('../dist/src/extratores');
const { montarTabela } = require('../dist/src/planilha/tabela');
const { renderXlsx } = require('../dist/src/planilha/render');

// time-card = cartão de ponto; payroll = holerite.
const TIPOS = {
  'time-card-01': 'cartao-ponto', 'time-card-02': 'cartao-ponto',
  'time-card-03': 'cartao-ponto', 'time-card-04': 'cartao-ponto',
  'payroll-01': 'holerite', 'payroll-02': 'holerite',
  'payroll-03': 'holerite', 'payroll-04': 'holerite',
};

const raiz = path.resolve(__dirname, '..');
const alvos = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TIPOS);

(async () => {
  for (const nome of alvos) {
    const tipo = TIPOS[nome];
    const pdf = path.join(raiz, 'exemplos', `${nome}.pdf`);
    if (!tipo || !fs.existsSync(pdf)) { console.log(`- ${nome}: pulado (sem tipo ou PDF)`); continue; }
    try {
      const paginas = await extrairPaginas(pdf);
      const value = extratorPara(tipo).extrair(paginas);
      const tabela = montarTabela(tipo, value);
      const buffer = await renderXlsx(tabela);
      fs.writeFileSync(path.join(raiz, 'saidas', `${nome}.xlsx`), buffer);
      console.log(`- ${nome}: OK (${tabela.linhas.length} linhas)`);
    } catch (e) {
      // Recusado (layout desconhecido) ou falha: não gera planilha.
      console.log(`- ${nome}: recusado (${e.message})`);
    }
  }
})();
