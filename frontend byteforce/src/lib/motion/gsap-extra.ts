"use client";
/** Route-specific GSAP plugins. Import from here only in components that need them. */
import { gsap } from "./gsap";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { Flip } from "gsap/Flip";
import { Draggable } from "gsap/Draggable";
import { InertiaPlugin } from "gsap/InertiaPlugin";

if (typeof window !== "undefined") {
  gsap.registerPlugin(MorphSVGPlugin, DrawSVGPlugin, MotionPathPlugin, Flip, Draggable, InertiaPlugin);
}

export { MorphSVGPlugin, DrawSVGPlugin, MotionPathPlugin, Flip, Draggable, InertiaPlugin };
