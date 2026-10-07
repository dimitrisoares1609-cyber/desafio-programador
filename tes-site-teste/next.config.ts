import type { NextConfig } from "next";

// URLs antigas do site oficial que passam a apontar para a rota única no protótipo.
// O pedido é 301 (e não o 308 padrão do `permanent: true`), por isso `statusCode`.
const redirecionamentos: Array<[origem: string, destino: string]> = [
  ["/quadro-branco", "/lousa-digital"],
  ["/lousa-ceramica", "/lousa-digital"],
  ["/lousa-digital/webclass-all-in-one", "/webclass-all-in-one"],
  ["/projetores", "/projetor-multimidia"],
  ["/monitor-interativo-categoria", "/tela-interativa"],
  ["/teste-formulario", "/contato"],
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Imagens continuam hospedadas no site oficial; nada é baixado nem editado.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "tes.com.br",
        pathname: "/wp-content/uploads/**",
      },
    ],
  },
  async redirects() {
    return redirecionamentos.map(([origem, destino]) => ({
      source: origem,
      destination: destino,
      statusCode: 301,
    }));
  },
  // Ambiente de teste: nenhuma rota pode ser indexada.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
