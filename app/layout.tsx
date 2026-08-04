import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin", "latin-ext"],
  variable: "--font-display",
});
const dmSans = DM_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-body",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  // Absolutní základ pro relativní og:image URL v podstránkách (např.
  // /app/join/[code]) — bez tohohle by crawler/náhled odkazu v SMS/
  // messengerech dostal relativní cestu, kterou neumí vyřešit.
  metadataBase: new URL("https://mooncher-web.vercel.app"),
  title: "Mooncher",
  description: "Voucherová platforma — Mooncher",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.ico",
    apple: "/icon-180.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#071613",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="cs">
      <body
        className={`${bricolage.variable} ${dmSans.variable} ${jetbrainsMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
