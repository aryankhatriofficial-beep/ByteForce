"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { MotionProvider } from "@/lib/motion/MotionProvider";
import { DataModeProvider } from "@/lib/DataModeProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { TransitionProvider } from "./PageTransition";
import { Nav } from "./Nav";
import { Footer } from "./Footer";
import { CommandPalette } from "./CommandPalette";
import { Cursor } from "./Cursor";
import { BootSequence } from "./BootSequence";

export function AppShell({ children }: { children: ReactNode }) {
  const [palette, setPalette] = useState(false);
  const close = useCallback(() => setPalette(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <MotionProvider>
      <DataModeProvider>
        <ToastProvider>
          <TransitionProvider>
            <a href="#main" className="skip-link">Skip to content</a>
            <Nav onOpenPalette={() => setPalette(true)} />
            <main id="main" tabIndex={-1}>{children}</main>
            <Footer />
            <CommandPalette open={palette} onClose={close} />
            <Cursor />
            <BootSequence />
          </TransitionProvider>
        </ToastProvider>
      </DataModeProvider>
    </MotionProvider>
  );
}
