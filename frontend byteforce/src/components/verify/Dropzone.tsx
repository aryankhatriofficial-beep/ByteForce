"use client";
import { useRef, useState, type DragEvent } from "react";
import { parseArtifactFilename, type ParsedIdentifier } from "@/lib/validation";
import { formatBytes, sha256File } from "@/lib/hash";
import { gsap } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import styles from "./Dropzone.module.css";

export interface LocalFile { name: string; size: number; sha256: string | null; parsed: ParsedIdentifier | null; error?: string }

/**
 * Local-only file intake. The file is NEVER uploaded: the browser parses its
 * filename and computes SHA-256 with WebCrypto for comparison with PyPI.
 */
export function Dropzone({ value, onChange }: { value: LocalFile | null; onChange: (f: LocalFile | null) => void }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const { reduced } = useMotion();

  const handle = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parseArtifactFilename(file.name);
    if (!/\.(whl|tar\.gz|zip)$/i.test(file.name)) {
      onChange({ name: file.name, size: file.size, sha256: null, parsed: null, error: "Only .whl, .tar.gz or .zip distributions are accepted." });
      return;
    }
    setBusy(true);
    try {
      const sha256 = await sha256File(file);
      onChange({ name: file.name, size: file.size, sha256, parsed });
    } catch (e) {
      onChange({ name: file.name, size: file.size, sha256: null, parsed, error: e instanceof Error ? e.message : "Could not hash file" });
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!reduced && zone.current) {
      // ripple from the drop point
      const r = zone.current.getBoundingClientRect();
      const ring = document.createElement("span");
      ring.className = styles.ring;
      ring.style.left = `${e.clientX - r.left}px`; ring.style.top = `${e.clientY - r.top}px`;
      zone.current.appendChild(ring);
      gsap.fromTo(ring, { scale: 0, opacity: 0.8 }, { scale: 14, opacity: 0, duration: 1.1, ease: "power2.out", onComplete: () => ring.remove() });
    }
    void handle(e.dataTransfer.files[0]);
  };

  return (
    <div
      ref={zone}
      className={styles.zone}
      data-over={over}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <input ref={input} type="file" accept=".whl,.tar.gz,.zip" className="sr-only" id="local-file" onChange={(e) => handle(e.target.files?.[0])} />
      {value ? (
        <div className={styles.file}>
          <span className="mono small break">{value.name}</span>
          <span className="xs muted mono">{formatBytes(value.size)} · {value.sha256 ? `sha256 ${value.sha256.slice(0, 16)}…` : value.error}</span>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => { onChange(null); if (input.current) input.current.value = ""; }}>Remove</button>
        </div>
      ) : (
        <label htmlFor="local-file" className={styles.label}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v4h16v-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
          <span>{busy ? "Hashing locally…" : <>Drop a <code>.whl</code> / <code>.tar.gz</code> or <u>choose a file</u></>}</span>
          <span className="xs muted">Hashed in your browser with WebCrypto. Never uploaded.</span>
        </label>
      )}
    </div>
  );
}
