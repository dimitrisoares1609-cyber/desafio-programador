import { expect, test } from "@playwright/test";

// Item 10 do checklist de testes: nenhuma resposta pode ser indexada.
test("toda resposta tem X-Robots-Tag: noindex", async ({ request }) => {
  for (const rota of ["/", "/robots.txt", "/rota-que-nao-existe"]) {
    const resposta = await request.get(rota, { maxRedirects: 0 });
    expect(resposta.headers()["x-robots-tag"], rota).toContain("noindex");
  }
});

test("robots.txt bloqueia tudo", async ({ request }) => {
  const texto = await (await request.get("/robots.txt")).text();
  expect(texto).toMatch(/Disallow: \/\s*$/m);
});

// Item 3 do checklist de testes: URLs antigas retornam 301 para a rota nova.
const redirecionamentos: Array<[string, string]> = [
  ["/quadro-branco", "/lousa-digital"],
  ["/lousa-ceramica", "/lousa-digital"],
  ["/lousa-digital/webclass-all-in-one", "/webclass-all-in-one"],
  ["/projetores", "/projetor-multimidia"],
  ["/monitor-interativo-categoria", "/tela-interativa"],
  ["/teste-formulario", "/contato"],
];

for (const [origem, destino] of redirecionamentos) {
  test(`${origem} redireciona com 301 para ${destino}`, async ({ request }) => {
    const resposta = await request.get(origem, { maxRedirects: 0 });
    expect(resposta.status()).toBe(301);
    expect(new URL(resposta.headers()["location"], "http://x").pathname).toBe(destino);
  });
}
