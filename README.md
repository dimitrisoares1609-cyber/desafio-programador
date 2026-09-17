# Portal Institucional Responsivo — Instituto Horizonte

Portal institucional de uma instituição de ensino fictícia, construído
exclusivamente com **HTML5, CSS3 e Bootstrap 5**, conforme o enunciado do
projeto (30% da avaliação parcial).

## Como visualizar

O site é estático: basta abrir `index.html` no navegador.

Para navegar com as URLs corretas (recomendado), suba um servidor local:

```bash
cd portal-institucional
python3 -m http.server 8000
# abra http://localhost:8000
```

## Estrutura de diretórios

```
portal-institucional/
├── index.html              página principal (RF01 a RF08)
├── areas-de-ensino.html    página secundária do menu suspenso
├── css/
│   └── estilo.css          estilos personalizados (CSS3)
└── img/                    ilustrações em SVG (logotipo, cursos, notícias)
```

HTML e CSS ficam separados: nenhuma regra de estilo está embutida nas páginas.

## Onde cada requisito foi atendido

| Requisito | Implementação |
|---|---|
| RF01 — Barra de navegação | `navbar navbar-expand-lg fixed-top` com logotipo, links para início, cursos, notícias e contato, dropdown "Áreas de Ensino" e menu colapsável (`navbar-toggler`) |
| RF02 — Seção principal | Seção `#inicio` com título, texto de apresentação, imagem ilustrativa e botão de chamada para ação |
| RF03 — Catálogo de cursos | Seção `#cursos` com 6 cards responsivos (`col-md-6 col-lg-4`), cada um com imagem, nome, descrição e botão de detalhes |
| RF04 — Indicadores | Seção `#indicadores` com alunos formados, cursos, professores e satisfação, organizados no Grid de 12 colunas (`col-6 col-lg-3`) |
| RF05 — Consulta de cursos | Seção `#consulta` com tabela de nome, modalidade, carga horária e investimento dentro de `table-responsive` |
| RF06 — Formulário de contato | Seção `#contato` com nome, e-mail, telefone, curso de interesse, mensagem e botão de envio |
| RF07 — Detalhes do curso | Um `modal` por curso, com objetivos, carga horária, público-alvo e descrição |
| RF08 — Rodapé | Endereço, telefone, e-mail, redes sociais e direitos autorais, repetidos nas duas páginas |
| RNF01 — Responsividade | Grid e utilitários do Bootstrap mais ajustes próprios nos breakpoints `lg` e `sm` |
| RNF02 — Tecnologias | Apenas HTML5, CSS3 e Bootstrap 5.3.3. Nenhum framework JavaScript e nenhuma linguagem de servidor |
| RNF03 — Organização | Indentação consistente, comentários por bloco, CSS separado do HTML e diretórios por tipo de arquivo |
| RNF04 — Usabilidade | Navegação por âncoras, foco visível no teclado, textos alternativos em todas as imagens e identidade visual comum às páginas |

## Sobre o JavaScript

O enunciado proíbe **frameworks JavaScript**. A única inclusão de script é o
bundle oficial do próprio Bootstrap, necessário para os componentes pedidos nos
requisitos: menu colapsável (RF01), dropdown (RF01), modal (RF07) e o accordion
da página de áreas. Não há código JavaScript próprio no projeto.

Os arquivos do Bootstrap vêm do CDN jsDelivr com verificação de integridade
(`integrity` + `crossorigin`). Os dois hashes foram conferidos contra os
arquivos oficiais da versão 5.3.3.

## Publicação

A entrega pede uma URL pública. Duas opções testadas:

**GitHub Pages** — o repositório já traz o workflow
`.github/workflows/pages.yml`, que publica esta pasta. Ative em
*Settings → Pages → Source: GitHub Actions* e rode o workflow (ele também roda
sozinho a cada push na branch principal que altere `portal-institucional/`).

**Netlify ou Vercel** — arraste a pasta `portal-institucional/` na área de
deploy manual. Não há build: o conteúdo é servido como está.

Depois de publicar, abra a URL em uma janela anônima para conferir que todos os
arquivos subiram.

## O que foi verificado no navegador

Testes feitos com Chromium em 1440×900, 820×1180 e 390×844:

- as duas páginas não apresentam erro de console nem requisição falha;
- nenhuma rolagem horizontal indevida em nenhum dos três tamanhos;
- menu colapsável, dropdown, modais e accordion abrem e fecham;
- o formulário bloqueia o envio com campos obrigatórios vazios, usando a
  validação nativa do HTML5;
- a tabela de cursos rola no eixo horizontal dentro do próprio container no
  celular, sem cortar colunas.
