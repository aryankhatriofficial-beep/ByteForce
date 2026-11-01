"use client";
import { useEffect, useRef, useState } from "react";
import { useMotion } from "@/lib/motion/MotionProvider";
import { ScrollTrigger } from "@/lib/motion/gsap";
import styles from "./ArtifactHero.module.css";

/**
 * Hero artifact. Loads three.js on demand; falls back to a static SVG of the
 * same exploded hex package if WebGL is missing, fails or the context is lost.
 * Paused off-screen and in hidden tabs; one static frame under reduced motion.
 */
export function ArtifactHero({ className = "" }: { className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [webgl, setWebgl] = useState(false);
  const { reduced, finePointer } = useMotion();

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const mod = await import("./artifactScene");
      if (disposed || !canvas.current || !wrap.current || !mod.webglAvailable()) return;
      const lowPower = (navigator.hardwareConcurrency ?? 8) <= 4 || innerWidth < 720;
      let scene: InstanceType<typeof mod.ArtifactScene>;
      try { scene = new mod.ArtifactScene({ canvas: canvas.current, quality: lowPower ? "low" : "high", animate: !reduced }); }
      catch { return; }
      setWebgl(true);
      const c = canvas.current;
      const ro = new ResizeObserver(() => scene.resize()); ro.observe(c);
      const io = new IntersectionObserver(([e]) => (e.isIntersecting && !document.hidden ? scene.play() : scene.pause())); io.observe(wrap.current);
      const onVis = () => (document.hidden ? scene.pause() : scene.play());
      document.addEventListener("visibilitychange", onVis);
      const onMove = (e: PointerEvent) => scene.setPointer((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
      if (finePointer && !reduced) addEventListener("pointermove", onMove, { passive: true });
      const st = ScrollTrigger.create({ trigger: wrap.current, start: "top top", end: "bottom top", onUpdate: (s) => scene.setScroll(s.progress) });
      const lost = (e: Event) => { e.preventDefault(); setWebgl(false); };
      c.addEventListener("webglcontextlost", lost);
      cleanup = () => {
        st.kill(); ro.disconnect(); io.disconnect();
        document.removeEventListener("visibilitychange", onVis);
        removeEventListener("pointermove", onMove);
        c.removeEventListener("webglcontextlost", lost);
        scene.dispose();
      };
    })();
    return () => { disposed = true; cleanup(); };
  }, [reduced, finePointer]);

  return (
    <div ref={wrap} className={`${styles.wrap} ${className}`} data-webgl={webgl} aria-hidden="true">
      <canvas ref={canvas} className={styles.canvas} />
      {!webgl && (
        <svg viewBox="0 0 300 300" className={styles.fallback}>
          <defs><linearGradient id="af-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f4f7ff" /><stop offset=".45" stopColor="#8d99bd" /><stop offset=".6" stopColor="#273256" /><stop offset="1" stopColor="#9d85ff" /></linearGradient></defs>
          {[60, 140, 220].map((y, i) => (
            <path key={y} d={`M150 ${y - 30} 230 ${y - 8} 230 ${y + 8} 150 ${y + 30} 70 ${y + 8} 70 ${y - 8}Z`} fill="url(#af-g)" opacity={1 - i * 0.18} stroke="#c3b4ff" strokeOpacity=".4" />
          ))}
          <circle cx="150" cy="140" r="12" fill="#5ef2c6" opacity=".85" />
        </svg>
      )}
      <div className={styles.halo} />
    </div>
  );
}
