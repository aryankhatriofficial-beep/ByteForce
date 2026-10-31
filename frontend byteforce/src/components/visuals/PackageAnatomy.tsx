"use client";
import { useMemo, useRef, useState } from "react";
import type { ArchiveInventory } from "@/lib/api/types";
import { formatBytes } from "@/lib/hash";
import { gsap, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import styles from "./PackageAnatomy.module.css";

interface Layer { id: string; title: string; caption: string; files: { path: string; size: number }[] }

/**
 * Exploded view of a wheel built from the real inventory: archive shell →
 * .dist-info metadata → Python modules → data/other. Scroll scrubs the
 * explosion; the button toggles it for keyboard/touch users.
 */
export function PackageAnatomy({ inventory }: { inventory: ArchiveInventory }) {
  const root = useRef<HTMLDivElement>(null);
  const [exploded, setExploded] = useState(true);
  const [focus, setFocus] = useState<string>("modules");
  const { reduced } = useMotion();

  const layers = useMemo<Layer[]>(() => {
    const by = (pred: (p: string, k: string) => boolean) => inventory.entries.filter((e) => pred(e.path, e.kind)).map((e) => ({ path: e.path, size: e.sizeBytes }));
    return [
      { id: "archive", title: inventory.artifact, caption: `${inventory.kind} · ${inventory.entries.length} entries · ${formatBytes(inventory.totalUncompressedBytes)} uncompressed`, files: [] },
      { id: "dist-info", title: ".dist-info", caption: "METADATA · WHEEL · RECORD · licenses", files: by((p) => p.includes(".dist-info/")) },
      { id: "modules", title: "Python modules", caption: "Importable code — listed, hashed, never executed", files: by((p, k) => k === "python" && !p.includes(".dist-info/")) },
      { id: "data", title: "Data & other", caption: "Markers, typing stubs, .pth and other files", files: by((p, k) => k !== "python" && !p.includes(".dist-info/")) },
    ];
  }, [inventory]);

  useGSAP(() => {
    if (!root.current) return;
    const plates = root.current.querySelectorAll("[data-plate]");
    if (reduced) { gsap.set(plates, { z: (i: number) => (exploded ? i * 70 : i * 8) }); return; }
    gsap.to(plates, { z: (i: number) => (exploded ? i * 70 : i * 8), duration: 1.1, ease: "pv.out", stagger: 0.05 });
  }, { scope: root, dependencies: [exploded, reduced] });

  useGSAP(() => {
    if (reduced || !root.current) return;
    gsap.fromTo(root.current.querySelector("[data-stage]"), { rotateX: 62, rotateZ: -38 }, {
      rotateX: 52, rotateZ: -28, ease: "none",
      scrollTrigger: { trigger: root.current, start: "top bottom", end: "bottom top", scrub: 1 },
    });
  }, { scope: root, dependencies: [reduced], revertOnUpdate: true });

  const active = layers.find((l) => l.id === focus) ?? layers[2];

  return (
    <div ref={root} className={styles.wrap}>
      <div className={styles.viewport}>
        <div className={styles.stage} data-stage>
          {layers.map((l, i) => (
            <button
              key={l.id}
              type="button"
              data-plate
              className={styles.plate}
              data-layer={l.id}
              aria-pressed={focus === l.id}
              style={{ zIndex: i }}
              onClick={() => setFocus(l.id)}
            >
              <span className={styles.plateTitle}>{l.title}</span>
              <span className={styles.plateCount}>{l.id === "archive" ? inventory.kind : `${l.files.length} files`}</span>
              <span className={styles.cells} aria-hidden="true">
                {l.files.slice(0, 24).map((f) => <i key={f.path} style={{ flexGrow: Math.max(1, Math.log2(f.size + 2)) }} />)}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className={styles.panel}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="eyebrow">Layer · {active.title}</span>
          <button type="button" className="btn btn--sm" onClick={() => setExploded((x) => !x)} aria-pressed={exploded}>{exploded ? "Collapse view" : "Explode view"}</button>
        </div>
        <p className="small muted">{active.caption}</p>
        {active.files.length > 0 ? (
          <ul className={styles.files}>
            {active.files.map((f) => <li key={f.path}><span className="mono break">{f.path}</span><span className="mono xs muted">{formatBytes(f.size)}</span></li>)}
          </ul>
        ) : <p className="small">Select a layer to list its files.</p>}
      </div>
    </div>
  );
}
