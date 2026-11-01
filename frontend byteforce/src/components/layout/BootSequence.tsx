"use client";
import { useEffect, useRef, useState } from "react";
import { gsap } from "@/lib/motion/gsap";
import styles from "./BootSequence.module.css";

const SPINE = ["Artifact", "Digest", "Metadata", "Attestation", "Publisher", "Source"];
const HEX = "M60 6 106.8 33v54L60 114 13.2 87V33Z";

/**
 * First-visit-per-session intro. The page is already rendered underneath; this
 * overlay never waits on anything and is gone within ~1.5 s (or immediately on
 * skip / Esc / click). Returning visits and reduced motion never see it — an
 * inline script in <head> hides it before first paint. A CSS fallback hides it
 * even if this script fails to run.
 */
export function BootSequence() {
  const root = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const el = root.current;
    if (!el || document.documentElement.classList.contains("pv-booted")) { setGone(true); return; }
    const done = () => {
      try { sessionStorage.setItem("pv.booted", "1"); } catch { /* ignore */ }
      document.documentElement.classList.add("pv-booted");
      setGone(true);
    };
    const q = gsap.utils.selector(el);
    const lines = Array.from(el.querySelectorAll<SVGGeometryElement>("[data-draw]"));
    lines.forEach((p) => { const L = p.getTotalLength(); p.style.strokeDasharray = `${L}`; p.style.strokeDashoffset = `${L}`; });

    const tl = gsap.timeline({ onComplete: done, defaults: { ease: "pv.out" } });
    tl.fromTo(q("[data-point]"), { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, transformOrigin: "50% 50%" })
      .to(lines, { strokeDashoffset: 0, duration: 0.55, stagger: 0.05, ease: "pv.inOut" }, 0.15)
      .fromTo(q("[data-grid]"), { scaleX: 0 }, { scaleX: 1, duration: 0.6, stagger: 0.04 }, 0.2)
      .fromTo(q("[data-beam]"), { xPercent: -110 }, { xPercent: 110, duration: 0.6, ease: "power2.inOut" }, 0.55)
      .fromTo(q("[data-node]"), { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.05 }, 0.62)
      .fromTo(q("[data-word]"), { opacity: 0, letterSpacing: "0.4em" }, { opacity: 1, letterSpacing: "-0.02em", duration: 0.5 }, 0.8)
      .to(q("[data-point]"), { scale: 3, opacity: 0, duration: 0.4 }, 0.85)
      .to(el, { clipPath: "inset(50% 0% 50% 0%)", duration: 0.42, ease: "pv.inOut" }, 1.12);

    const skip = () => { tl.progress(1); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") skip(); };
    addEventListener("keydown", onKey);
    el.addEventListener("pointerdown", skip);
    return () => { tl.kill(); removeEventListener("keydown", onKey); el.removeEventListener("pointerdown", skip); };
  }, []);

  if (gone) return null;
  return (
    <div id="pv-boot" ref={root} className={styles.boot} role="presentation">
      <div className={styles.grid} aria-hidden="true">
        {[0, 1, 2, 3].map((i) => <span key={i} data-grid className={styles.gridLine} style={{ top: `${30 + i * 13}%` }} />)}
      </div>
      <div className={styles.center} aria-hidden="true">
        <svg viewBox="0 0 120 120" className={styles.hex}>
          <defs>
            <linearGradient id="boot-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#eef3ff" /><stop offset=".55" stopColor="#9d85ff" /><stop offset="1" stopColor="#ff4fd8" /></linearGradient>
          </defs>
          <path data-draw d={HEX} fill="none" stroke="url(#boot-g)" strokeWidth="1.4" />
          <path data-draw d="M60 22 93 41v38L60 98 27 79V41Z" fill="none" stroke="#3a4670" strokeWidth="1" />
          <path data-draw d="M40 48 60 60l20-12M60 60v24" fill="none" stroke="#eef3ff" strokeWidth="1.6" strokeLinecap="round" />
          <circle data-point cx="60" cy="60" r="4" fill="#5ef2c6" />
        </svg>
        <div data-word className={styles.word}>PyVerify</div>
      </div>
      <div className={styles.beamTrack} aria-hidden="true"><span data-beam className={styles.beam} /></div>
      <ol className={styles.spine} aria-hidden="true">
        {SPINE.map((s) => <li key={s} data-node>{s}</li>)}
      </ol>
      <button type="button" className={styles.skip} onClick={() => root.current?.dispatchEvent(new PointerEvent("pointerdown"))}>Skip intro</button>
    </div>
  );
}
