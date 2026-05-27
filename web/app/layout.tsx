import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jbMono = JetBrains_Mono({
  variable: "--font-jbmono",
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Perplex — Perpetual Futures",
  description: "Decentralised perpetual futures exchange. Trade BTC, ETH, SOL with up to 20x leverage.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

const themeInit = `(function(){try{var k='perplex-theme';var s=localStorage.getItem(k);var t=(s==='light'||s==='dark')?s:'light';var r=document.documentElement;r.classList.remove('light','dark');r.classList.add(t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jbMono.variable} ${spaceGrotesk.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Read the persisted theme out of localStorage and apply the class to
            <html> before paint, so the page never flashes the wrong theme.
            Inline <script> in <head> via dangerouslySetInnerHTML — Next 16
            stopped executing <Script strategy="beforeInteractive"> blocks
            rendered inside the body, so we drop the wrapper and stay in
            head where the FOUC fix actually runs. */}
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-dvh flex flex-col" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
