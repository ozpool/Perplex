import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Script from "next/script";
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
      <body className="min-h-dvh flex flex-col" suppressHydrationWarning>
        {/* Read the persisted theme out of localStorage and apply the class to
            <html> before paint, so the page never flashes the wrong theme.
            next/script with `beforeInteractive` is the React-19-safe way to
            ship an inline script in the App Router. */}
        <Script id="perplex-theme-init" strategy="beforeInteractive">
          {themeInit}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
