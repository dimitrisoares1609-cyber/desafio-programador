import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TES Tecnologia", template: "%s | TES Tecnologia" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
