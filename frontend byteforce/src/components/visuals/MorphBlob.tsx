"use client";
import { useId, useRef } from "react";
import { gsap, useGSAP } from "@/lib/motion/gsap";
import "@/lib/motion/gsap-extra";
import { useMotion } from "@/lib/motion/MotionProvider";

const SHAPES = [
  "M421,302Q392,354,349,392Q306,430,246,433Q186,436,140,397Q94,358,74,301Q54,244,82,190Q110,136,164,108Q218,80,277,87Q336,94,378,139Q420,184,435,242Q450,300,421,302Z",
  "M437,313Q404,376,345,409Q286,442,224,424Q162,406,114,362Q66,318,70,252Q74,186,120,138Q166,90,232,77Q298,64,348,108Q398,152,434,201Q470,250,437,313Z",
  "M402,322Q384,394,316,418Q248,442,186,414Q124,386,96,325Q68,264,92,203Q116,142,172,104Q228,66,296,82Q364,98,398,161Q432,224,417,273Q402,322,402,322Z",
  "M445,296Q414,342,382,389Q350,436,288,437Q226,438,170,413Q114,388,85,329Q56,270,75,205Q94,140,153,112Q212,84,277,79Q342,74,391,118Q440,162,458,206Q476,250,445,296Z",
];

interface Props {
  className?: string;
  /** chrome = silver liquid metal; uv = ultraviolet plasma gradient. */
  tone?: "chrome" | "uv";
  /** Adds an SVG turbulence displacement for a liquid edge. */
  liquid?: boolean;
  duration?: number;
}

/** Morphing gradient blob (MorphSVG). Static first shape under reduced motion. Decorative. */
export function MorphBlob({ className, tone = "uv", liquid = false, duration = 6 }: Props) {
  const root = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/:/g, "");
  const { reduced } = useMotion();

  useGSAP(() => {
    if (reduced || !root.current) return;
    const path = root.current.querySelector("[data-blob]");
    const tl = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut", duration } });
    SHAPES.slice(1).forEach((d) => tl.to(path, { morphSVG: d }));
    gsap.to(root.current.querySelector("[data-grad]"), { attr: { gradientTransform: "rotate(220 .5 .5)" }, duration: duration * 3, repeat: -1, yoyo: true, ease: "sine.inOut" });
    // Note: the turbulence filter is static on purpose — animating filter parameters re-rasterises every frame.
  }, { scope: root, dependencies: [reduced], revertOnUpdate: true });

  return (
    <svg ref={root} className={className} viewBox="0 0 500 500" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`g${uid}`} data-grad x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(0 .5 .5)">
          {tone === "chrome" ? (
            <>
              <stop offset="0" stopColor="#f4f7ff" /><stop offset="0.3" stopColor="#8d99bd" /><stop offset="0.5" stopColor="#1b2442" />
              <stop offset="0.68" stopColor="#c9d2ea" /><stop offset="0.85" stopColor="#7a5cff" /><stop offset="1" stopColor="#ff4fd8" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#5634f0" /><stop offset="0.55" stopColor="#9d85ff" /><stop offset="1" stopColor="#ff4fd8" />
            </>
          )}
        </linearGradient>
        {liquid && (
          <filter id={`f${uid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="2" seed="7" />
            <feDisplacementMap in="SourceGraphic" scale="26" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        )}
      </defs>
      <path data-blob d={SHAPES[0]} fill={`url(#g${uid})`} filter={liquid ? `url(#f${uid})` : undefined} />
    </svg>
  );
}
