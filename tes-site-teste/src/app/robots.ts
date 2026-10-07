import type { MetadataRoute } from "next";

// Protótipo de teste: nada deve ser indexado.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
