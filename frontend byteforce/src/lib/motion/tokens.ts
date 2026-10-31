/** Motion tokens — mirror of the CSS custom properties in globals.css. Seconds for GSAP. */
export const DUR = { instant: 0.09, fast: 0.18, base: 0.32, slow: 0.56, scene: 0.9 } as const;
export const EASE = { out: "pv.out", inOut: "pv.inOut", spring: "back.out(1.6)", linear: "none" } as const;
export const STAGGER = { tight: 0.03, base: 0.06, loose: 0.1 } as const;
/** Route transition budget (ms): cover, navigate, reveal. Navigation never waits longer than `navigateBy`. */
export const ROUTE = { cover: 300, navigateBy: 340, reveal: 460, safety: 2500 } as const;
