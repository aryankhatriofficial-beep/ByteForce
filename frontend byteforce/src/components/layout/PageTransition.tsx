"use client";
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode, type MouseEvent, type AnchorHTMLAttributes } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { gsap } from "@/lib/motion/gsap";
import { ROUTE } from "@/lib/motion/tokens";
import { useMotion } from "@/lib/motion/MotionProvider";
import { routeFor, ROUTES } from "@/lib/routes";
import styles from "./PageTransition.module.css";

interface TransitionCtx {
  navigate: (href: string) => void;
  /** Called by app/template.tsx on every route mount. Returns true if a covered transition was revealed. */
  reveal: () => boolean;
}

const Ctx = createContext<TransitionCtx>({ navigate: () => {}, reveal: () => false });
const SPINE = ["Artifact", "Digest", "Metadata", "Attestation", "Publisher", "Source"];
const order = (path: string) => ROUTES.findIndex((r) => (r.href === "/" ? path === "/" : path.startsWith(r.href)));

/**
 * Signature route transition:
 *   cover (≈300 ms) — void veil slides in with chrome edges; evidence spine draws; destination named.
 *   navigate        — router.push at the end of cover, guaranteed by a timer even if rAF is throttled.
 *   reveal (≈460 ms)— UV beam scans across, veil exits the opposite side, page content enters.
 * Direction follows route order. Repeated clicks retarget the pending navigation (latest wins).
 * Back/forward and direct loads get a light "arrival" sweep from template.tsx instead.
 */
export function TransitionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { reduced } = useMotion();
  const stage = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const target = useRef<string | null>(null);
  const pushedFor = useRef<string | null>(null);
  const dir = useRef(1);
  const tl = useRef<gsap.core.Timeline | null>(null);
  const timers = useRef<number[]>([]);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const hide = useCallback(() => {
    pending.current = false;
    target.current = null;
    tl.current?.kill();
    clearTimers();
    if (stage.current) gsap.set(stage.current, { visibility: "hidden" });
    gsap.set("main", { clearProps: "opacity" });
  }, []);

  const navigate = useCallback((href: string) => {
    const dest = href.split(/[?#]/)[0] || "/";
    const el = stage.current;
    if (reduced || !el || (dest === pathname && !href.includes("?"))) { router.push(href); return; }

    target.current = href;
    if (pending.current) {
      // Already covering: just retarget. If we already pushed, push the newer target.
      if (pushedFor.current) { pushedFor.current = href; router.push(href); }
      const r = routeFor(dest);
      el.querySelector("[data-dest]")!.textContent = r.label;
      return;
    }
    pending.current = true;
    pushedFor.current = null;
    dir.current = order(dest) >= order(pathname) ? 1 : -1;

    const r = routeFor(dest);
    el.querySelector("[data-dest]")!.textContent = r.label;
    el.querySelector("[data-blurb]")!.textContent = r.blurb;

    const q = gsap.utils.selector(el);
    const veil = q("[data-veil]");
    const line = el.querySelector<SVGPathElement>("[data-line]")!;
    const L = line.getTotalLength();
    const go = () => {
      if (pushedFor.current || !target.current) return;
      pushedFor.current = target.current;
      router.push(target.current);
    };

    tl.current?.kill();
    clearTimers();
    tl.current = gsap.timeline()
      .set(el, { visibility: "visible" })
      .set(line, { strokeDasharray: L, strokeDashoffset: L })
      .set(q("[data-node]"), { scale: 0.4, opacity: 0.25 })
      .set(q("[data-label]"), { opacity: 0, y: 10 })
      .fromTo(veil, { xPercent: 104 * dir.current }, { xPercent: 0, duration: ROUTE.cover / 1000, ease: "pv.inOut" })
      .to("main", { opacity: 0.35, duration: 0.24, ease: "power1.out" }, 0)
      .to(line, { strokeDashoffset: 0, duration: 0.42, ease: "pv.out" }, 0.12)
      .to(q("[data-node]"), { scale: 1, opacity: 1, duration: 0.3, stagger: 0.04, ease: "back.out(2)" }, 0.16)
      .to(q("[data-label]"), { opacity: 1, y: 0, duration: 0.3, stagger: 0.05 }, 0.2)
      .add(go, ROUTE.cover / 1000);

    // Navigation never depends on animation frames.
    timers.current.push(window.setTimeout(go, ROUTE.navigateBy));
    // Never leave the veil up if the new route fails to mount.
    timers.current.push(window.setTimeout(() => { if (pending.current) hide(); }, ROUTE.safety));
  }, [pathname, reduced, router, hide]);

  const reveal = useCallback(() => {
    const el = stage.current;
    if (!el || !pending.current) return false;
    pending.current = false;
    clearTimers();
    const q = gsap.utils.selector(el);
    tl.current?.kill();
    gsap.set("main", { clearProps: "opacity" });
    tl.current = gsap.timeline({ onComplete: () => { gsap.set(el, { visibility: "hidden" }); target.current = null; } })
      .fromTo(q("[data-beam]"), { xPercent: -100 * dir.current }, { xPercent: 100 * dir.current, duration: 0.42, ease: "power2.inOut" }, 0)
      .to(q("[data-label]"), { opacity: 0, y: -8, duration: 0.18 }, 0)
      .to(q("[data-veil]"), { xPercent: -104 * dir.current, duration: ROUTE.reveal / 1000, ease: "pv.inOut" }, 0.06);
    return true;
  }, []);

  // Park the veil and beam off-screen with GSAP (CSS transforms would be parsed as fixed px offsets).
  useEffect(() => {
    const el = stage.current;
    if (el) gsap.set([el.querySelector("[data-veil]"), el.querySelector("[data-beam]")], { xPercent: 104 });
    return () => clearTimers();
  }, []);

  return (
    <Ctx.Provider value={{ navigate, reveal }}>
      {children}
      <div ref={stage} className={styles.stage} aria-hidden="true">
        <div data-veil className={styles.veil}>
          <span className={styles.edgeL} /><span className={styles.edgeR} />
          <div className={styles.center}>
            <svg viewBox="0 0 600 40" className={styles.spine}>
              <path data-line d="M20 20H580" className={styles.line} />
              {SPINE.map((_, i) => <circle key={i} data-node cx={20 + i * 112} cy="20" r="5" className={styles.node} />)}
            </svg>
            <ol className={styles.labels}>{SPINE.map((s) => <li key={s} data-label>{s}</li>)}</ol>
            <p className={styles.dest} data-label><span data-dest /></p>
            <p className={styles.blurb} data-label><span data-blurb /></p>
          </div>
        </div>
        <span data-beam className={styles.beam} />
      </div>
    </Ctx.Provider>
  );
}

export const usePageTransition = () => useContext(Ctx);

type TLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string; children: ReactNode; ref?: React.Ref<HTMLAnchorElement> };

/** Drop-in Link that plays the route transition for same-origin navigations. */
export function TransitionLink({ href, onClick, children, ...rest }: TLinkProps) {
  const { navigate } = usePageTransition();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (!href.startsWith("/") || href.startsWith("/#") || rest.target === "_blank") return;
    e.preventDefault();
    navigate(href);
  };
  return <Link href={href} onClick={handle} {...rest}>{children}</Link>;
}
