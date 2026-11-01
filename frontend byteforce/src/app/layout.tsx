import type { Metadata, Viewport } from "next";
import { Archivo, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { AppShell } from "@/components/layout/AppShell";
import "./globals.css";

// Three families: display (Archivo, variable width), UI (Inter Tight), data (JetBrains Mono).
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", axes: ["wdth"], display: "swap" });
const inter = Inter_Tight({ subsets: ["latin"], variable: "--font-inter-tight", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: { default: "PyVerify — Beyond the binary", template: "%s · PyVerify" },
  description: "Verify a published Python artifact, who published it, and — when cryptographic evidence allows — where it came from. Without installing or executing it.",
  applicationName: "PyVerify",
};

export const viewport: Viewport = { themeColor: "#03040a", colorScheme: "dark" };

/** Runs before first paint: skip the intro for returning sessions and reduced-motion users. */
const BOOT_SCRIPT = `try{var d=document.documentElement;if(sessionStorage.getItem('pv.booted')||matchMedia('(prefers-reduced-motion: reduce)').matches||localStorage.getItem('pv.motion')==='reduce'){d.classList.add('pv-booted')}}catch(e){document.documentElement.classList.add('pv-booted')}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${archivo.variable} ${inter.variable} ${mono.variable}`} data-motion="full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
