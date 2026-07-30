import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Omni Platform",
  description: "Plataforma omnichannel de WhatsApp e telefonia SIP",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
