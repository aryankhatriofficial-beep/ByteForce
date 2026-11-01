"use client";
/**
 * Core GSAP registration — loaded on every route, so it stays small:
 * gsap, ScrollTrigger, SplitText, ScrambleText, CustomEase, useGSAP.
 * Route-specific plugins live in ./gsap-extra.ts so they ship only where used.
 */
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { CustomEase } from "gsap/CustomEase";
import { useGSAP } from "@gsap/react";

if (typeof window !== "undefined") {
  gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText, ScrambleTextPlugin, CustomEase);
  CustomEase.create("pv.out", "0.16, 1, 0.3, 1");
  CustomEase.create("pv.inOut", "0.76, 0, 0.24, 1");
  gsap.defaults({ ease: "pv.out", duration: 0.56 });
  ScrollTrigger.config({ ignoreMobileResize: true });
}

export { gsap, ScrollTrigger, SplitText, ScrambleTextPlugin, useGSAP };

/** Scramble alphabet used for hash / identifier reveals. */
export const HEX_CHARS = "0123456789abcdef";
