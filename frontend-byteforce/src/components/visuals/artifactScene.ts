/**
 * Hero artifact: an exploded, faceted chrome "package" — three hexagonal
 * plates (archive shell, metadata, modules) around a luminous evidence core.
 * ~120 triangles total; chrome comes from a procedural studio environment in
 * the fragment shader (flat facet normals via derivatives). Named imports keep
 * the three.js bundle tree-shaken. Lazy-loaded by ArtifactHero.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, CylinderGeometry, IcosahedronGeometry, EdgesGeometry,
  ShaderMaterial, LineBasicMaterial, Mesh, LineSegments, Group, Color, Vector2, AdditiveBlending,
} from "three";

const vertex = /* glsl */ `
varying vec3 vView; varying vec3 vWorldPos; varying vec3 vBulge;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // A "pillow" normal: pushes each facet's normal toward the plate's centre-out direction,
  // so reflections sweep across faces like polished metal instead of flat colour.
  vBulge = normalize(normalMatrix * normalize(position * vec3(1.0, 2.2, 1.0)));
  vView = -mv.xyz;
  vWorldPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const fragment = /* glsl */ `
precision highp float;
uniform vec3 uTint; uniform float uTime; uniform vec2 uLight;
varying vec3 vView; varying vec3 vWorldPos; varying vec3 vBulge;
vec3 env(vec3 r){
  float y = r.y + uLight.y * 0.25;
  float x = r.x + uLight.x * 0.35;
  vec3 col = mix(vec3(0.004,0.005,0.014), vec3(0.03,0.04,0.09), smoothstep(-1.0, 0.6, y));
  col += vec3(0.96,0.97,1.0) * smoothstep(0.06, 0.0, abs(y - 0.42)) * 2.2;
  col += vec3(0.80,0.84,0.98) * smoothstep(0.035, 0.0, abs(y - 0.78)) * 1.4;
  col += vec3(0.62,0.68,0.88) * smoothstep(0.025, 0.0, abs(y + 0.12)) * 1.0;
  col += vec3(0.9,0.92,1.0) * smoothstep(0.02, 0.0, abs(x - 0.55)) * 0.9;
  col += vec3(0.48,0.36,1.0) * pow(max(0.0, -x), 3.0) * 1.6;
  col += vec3(1.0,0.31,0.85) * pow(max(0.0, x), 6.0) * 0.8;
  return col;
}
void main(){
  vec3 flatN = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  vec3 n = normalize(mix(flatN, vBulge, 0.38));
  vec3 v = normalize(vView);
  vec3 r = reflect(-v, n);
  float fres = pow(1.0 - max(dot(flatN, v), 0.0), 2.4);
  vec3 col = env(r) * uTint;
  col += vec3(0.47,0.36,1.0) * fres * 0.6;
  col = col / (col + vec3(0.8));
  gl_FragColor = vec4(pow(col, vec3(0.92)), 1.0);
}`;

const coreFragment = /* glsl */ `
precision highp float;
uniform float uTime; varying vec3 vView; varying vec3 vWorldPos;
void main(){
  vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  float f = pow(1.0 - abs(dot(n, normalize(vView))), 1.5);
  vec3 col = mix(vec3(0.37,0.95,0.78), vec3(0.62,0.52,1.0), f) * (1.2 + 0.25 * sin(uTime * 1.6));
  gl_FragColor = vec4(col, 0.9);
}`;

export interface ArtifactSceneOptions { canvas: HTMLCanvasElement; quality: "high" | "low"; animate: boolean }

export class ArtifactScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(30, 1, 0.1, 50);
  private group = new Group();
  private plates: Mesh[] = [];
  private disposables: { dispose(): void }[] = [];
  private mats: ShaderMaterial[] = [];
  private raf = 0;
  private running = false;
  private start = performance.now();
  private pointer = new Vector2();
  private pointerTarget = new Vector2();
  private scroll = 0;
  private scrollSmoothed = 0;

  constructor(private opts: ArtifactSceneOptions) {
    this.renderer = new WebGLRenderer({ canvas: opts.canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.quality === "high" ? 1.5 : 1));
    this.renderer.setClearColor(0x000000, 0);
    this.camera.position.set(0, 0.4, 7.2);
    this.camera.lookAt(0, 0, 0);

    const tints = [new Color(1.05, 1.08, 1.15), new Color(0.82, 0.74, 1.15), new Color(0.6, 0.66, 0.9)];
    const radii = [1.35, 1.18, 1.0];
    const heights = [0.32, 0.28, 0.42];
    tints.forEach((tint, i) => {
      const geo = new CylinderGeometry(radii[i], radii[i] * 0.94, heights[i], 6, 1);
      const mat = new ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: { uTint: { value: tint }, uTime: { value: 0 }, uLight: { value: this.pointer } } });
      const mesh = new Mesh(geo, mat);
      mesh.rotation.y = Math.PI / 6;
      const edges = new EdgesGeometry(geo);
      const lineMat = new LineBasicMaterial({ color: 0xc3b4ff, transparent: true, opacity: 0.35 });
      mesh.add(new LineSegments(edges, lineMat));
      this.group.add(mesh);
      this.plates.push(mesh);
      this.mats.push(mat);
      this.disposables.push(geo, mat, edges, lineMat);
    });

    const coreGeo = new IcosahedronGeometry(0.34, 1);
    const coreMat = new ShaderMaterial({ vertexShader: vertex, fragmentShader: coreFragment, uniforms: { uTime: { value: 0 } }, transparent: true, blending: AdditiveBlending, depthWrite: false });
    const core = new Mesh(coreGeo, coreMat);
    this.group.add(core);
    this.mats.push(coreMat);
    this.disposables.push(coreGeo, coreMat);

    this.group.rotation.x = 0.42;
    this.scene.add(this.group);
    this.resize();
  }

  resize() {
    const c = this.opts.canvas;
    const w = c.clientWidth || 1, h = c.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.running) this.frame();
  }

  setPointer(x: number, y: number) { this.pointerTarget.set(x, y); if (!this.running) this.frame(); }
  setScroll(p: number) { this.scroll = p; if (!this.running) this.frame(); }

  play() {
    if (this.running || !this.opts.animate) { this.frame(); return; }
    this.running = true;
    const loop = () => { if (!this.running) return; this.frame(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  pause() { this.running = false; cancelAnimationFrame(this.raf); }

  private frame() {
    const t = this.opts.animate ? (performance.now() - this.start) / 1000 : 2.2;
    this.pointer.lerp(this.pointerTarget, 0.07);
    this.scrollSmoothed += (this.scroll - this.scrollSmoothed) * 0.1;
    // Plates separate as the hero scrolls away — the "exploded" package.
    const gap = 0.42 + this.scrollSmoothed * 1.1;
    this.plates[0].position.y = gap;
    this.plates[1].position.y = 0;
    this.plates[2].position.y = -gap;
    this.plates.forEach((p, i) => { p.rotation.y = Math.PI / 6 + t * 0.12 * (i % 2 ? -1 : 1) * (1 + this.scrollSmoothed); });
    this.group.rotation.y = t * 0.15 + this.pointer.x * 0.45;
    this.group.rotation.x = 0.42 - this.pointer.y * 0.25 + this.scrollSmoothed * 0.4;
    this.mats.forEach((m) => { if (m.uniforms.uTime) m.uniforms.uTime.value = t; });
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.pause();
    this.disposables.forEach((d) => d.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
