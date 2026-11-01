"use client";
import { useRef, type ReactNode, type MouseEvent, type ButtonHTMLAttributes } from "react";
import { gsap, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import { TransitionLink } from "@/components/layout/PageTransition";

type Variant = "primary" | "default" | "ghost";

interface CommonProps {
  children: ReactNode;
  variant?: Variant;
  size?: "md" | "sm";
  /** Magnetic pull toward the cursor (fine pointers only, disabled under reduced motion). */
  magnetic?: boolean;
  className?: string;
}

type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type LinkProps = CommonProps & { href: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void; "aria-label"?: string; external?: boolean };

/** Shared button: spring-magnetic hover + click ripple. Renders a TransitionLink when `href` is set. */
export function Button(props: ButtonProps | LinkProps) {
  const { children, variant = "default", size = "md", magnetic = false, className = "" } = props;
  const ref = useRef<HTMLElement>(null);
  const { reduced, finePointer } = useMotion();
  const cls = `btn ${variant === "primary" ? "btn--primary" : variant === "ghost" ? "btn--ghost" : ""} ${size === "sm" ? "btn--sm" : ""} ${className}`;

  useGSAP((_, contextSafe) => {
    const el = ref.current;
    if (!el || !magnetic || reduced || !finePointer || !contextSafe) return;
    const xTo = gsap.quickTo(el, "x", { duration: 0.6, ease: "elastic.out(1, 0.4)" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.6, ease: "elastic.out(1, 0.4)" });
    const move = contextSafe((e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * 0.28);
      yTo((e.clientY - (r.top + r.height / 2)) * 0.36);
    });
    const leave = contextSafe(() => { xTo(0); yTo(0); });
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); };
  }, { dependencies: [magnetic, reduced, finePointer], revertOnUpdate: true });

  const ripple = (e: MouseEvent<HTMLElement>) => {
    if (reduced) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const dot = document.createElement("span");
    dot.className = "ripple";
    dot.style.left = `${e.clientX - r.left}px`;
    dot.style.top = `${e.clientY - r.top}px`;
    el.appendChild(dot);
    gsap.to(dot, { scale: Math.max(r.width, r.height) / 6, opacity: 0, duration: 0.8, ease: "power2.out", onComplete: () => dot.remove() });
  };

  if (props.href !== undefined) {
    const { href, onClick, external } = props as LinkProps;
    if (external) {
      return (
        <a ref={ref as React.Ref<HTMLAnchorElement>} href={href} className={cls} target="_blank" rel="noreferrer noopener" aria-label={props["aria-label"]} onClick={(e) => { ripple(e); onClick?.(e); }}>
          {children}
        </a>
      );
    }
    return (
      <TransitionLink ref={ref as React.Ref<HTMLAnchorElement>} href={href} className={cls} aria-label={props["aria-label"]} onClick={(e) => { ripple(e); onClick?.(e); }}>
        {children}
      </TransitionLink>
    );
  }
  const { variant: _v, size: _s, magnetic: _m, className: _c, children: _ch, onClick, type = "button", ...rest } = props as ButtonProps;
  void _v; void _s; void _m; void _c; void _ch;
  return (
    <button ref={ref as React.Ref<HTMLButtonElement>} type={type} className={cls} onClick={(e) => { ripple(e); onClick?.(e); }} {...rest}>
      {children}
    </button>
  );
}
