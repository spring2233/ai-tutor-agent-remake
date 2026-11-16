import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import {
  atmosphereFragmentShader,
  atmosphereVertexShader,
  planetFragmentShader,
  planetVertexShader,
} from './planetShaders';

export type CosmosMode = 'wander' | 'arena';
export type ViewMode = 'landing' | 'galaxy' | 'orbit';

export interface DocumentItem {
  id: string;
  name?: string;
  filename?: string;
  pages?: number;
  status?: string;
}

export interface PlanetAnchor {
  id: string;
  name: string;
  index: number;
  x: number;
  y: number;
  visible: boolean;
  status: string;
}

export interface CosmosOptions {
  mode?: CosmosMode;
  skipIntro?: boolean;
  onLoaded?: () => void;
  onIntroDone?: () => void;
  onAnchors?: (anchors: PlanetAnchor[]) => void;
  onPlanetClick?: (docId: string) => void;
  onUploadPortalClick?: () => void;
}

// ============================================================================
// 1. 后期处理 Shader：柔和 RGB 色差 + 动态暗角 (Vignette) + 胶片微噪点
// ============================================================================
const PostFXShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSpeed: { value: 0.0 },
    uTime: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSpeed;
    uniform float uTime;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 center = vUv - 0.5;
      float dist = length(center);

      // 边缘轻微径向色差
      float aberration = dist * dist * (0.005 + uSpeed * 0.012);
      vec2 dir = normalize(center + 1e-5);
      float r = texture2D(tDiffuse, vUv + dir * aberration).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - dir * aberration).b;
      vec3 col = vec3(r, g, b);

      // 柔和暗角，压暗四周突出中心文字
      float vigRadius = 0.82 - uSpeed * 0.15;
      float vig = smoothstep(vigRadius, vigRadius - 0.52, dist);
      col *= mix(0.18, 1.0, vig);

      // 微弱胶片颗粒
      float grain = (hash(vUv * 800.0 + uTime) - 0.5) * 0.02;
      col += grain;

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

// ============================================================================
// 2. 花谷 & 战场粒子 Vertex & Fragment Shaders
// ============================================================================
const valleyVertexShader = /* glsl */ `
  attribute float aScale;
  attribute float aSeed;
  attribute float aType; // 0.0: 花朵, 1.0: 底层叶片/草甸, 2.0: 悬浮光尘
  attribute vec3 aRandomDir;

  uniform float uTime;
  uniform float uScrollZ;
  uniform float uHover;
  uniform vec2 uMouse;
  uniform float uAspect;
  uniform float uPixelRatio;
  uniform float uIntro;
  uniform float uIsArena;
  uniform float uGalaxy;

  varying float vAlpha;
  varying float vMouseGlow;
  varying float vType;
  varying float vSeed;
  varying float vDepthRatio;
  varying float vCenterClearance;

  // 蜿蜒山谷中心轨迹
  float getPathX(float z) {
    return sin(z * 0.028) * 6.5 + cos(z * 0.014) * 3.5;
  }

  // 地形高度计算：低谷压低在画面中下部，两侧自然抬升，拒绝生硬的 V 字折线
  float getTerrainY(float x, float z) {
    float pathX = getPathX(z);
    float dx = x - pathX;
    // 平缓宽阔的谷底 + 两侧柔和山坡
    float valleyWall = smoothstep(2.0, 32.0, abs(dx)) * 11.5;
    float hills = sin(x * 0.12 + z * 0.08) * cos(z * 0.09 - x * 0.05) * 1.8
                + sin(x * 0.25 - z * 0.18) * 0.5;
    return valleyWall + hills - 5.2;
  }

  void main() {
    vType = aType;
    vSeed = aSeed;

    float span = 120.0;
    float worldZ = -mod(uScrollZ - position.z, span) + 8.0;
    float absZ = worldZ - uScrollZ;
    float pathX = getPathX(absZ);

    vec3 pos = vec3(position.x + pathX * 0.55, 0.0, worldZ);

    if (uIsArena > 0.5) {
      // Arena 闯关模式：环绕型深空能量场，中心留空给战斗舞台
      float angle = aSeed * 6.2831 + uTime * (0.06 + aType * 0.02);
      float radius = 14.0 + abs(position.x) * 0.85;
      pos.x = cos(angle) * radius;
      pos.z = sin(angle) * radius - 32.0;
      pos.y = position.y * 4.5 + sin(uTime * 0.8 + aSeed * 12.0) * 1.5 - 2.0;
      vCenterClearance = 1.0;
    } else {
      // Wander 首页花谷模式
      float groundY = getTerrainY(pos.x, absZ);
      float distFromCenter = abs(pos.x - pathX);

      // 关键防过曝设计：峡谷正中央留出呼吸通道，避免远处中心聚成一团白光挡住大标题
      vCenterClearance = smoothstep(0.0, 5.5, distFromCenter);

      if (aType < 1.5) {
        pos.y = groundY + position.y * 0.25;
        float wind = sin(uTime * 1.4 + pos.x * 0.35 + worldZ * 0.25 + aSeed * 6.28) * 0.14;
        pos.x += wind;
      } else {
        pos.y = groundY + 2.0 + mod(position.y + uTime * 0.35 + aSeed * 10.0, 12.0);
        pos.x += sin(uTime * 0.6 + aSeed * 12.0) * 1.0;
      }
    }

    // Hover 圆箭头：花海轻柔向四周散开成悬浮微光
    if (uHover > 0.001) {
      vec3 disperse = aRandomDir * (5.0 + aSeed * 6.5) * uHover;
      disperse.y += abs(aRandomDir.y) * 3.5 * uHover;
      pos += disperse;
    }

    pos.y -= uGalaxy * 7.5;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float dist = -mvPosition.z;
    vDepthRatio = clamp(dist / 100.0, 0.0, 1.0);

    // 距离绽放：近处花朵放大，远处迅速收敛尺寸防止像素堆积过曝
    float bloomCurve = aType < 0.5
      ? smoothstep(72.0, 14.0, dist) * (0.35 + 0.65 * smoothstep(32.0, 8.0, dist))
      : smoothstep(90.0, 22.0, dist) * 0.55;

    float nearFade = smoothstep(2.0, 7.5, dist);
    float farFade = 1.0 - smoothstep(55.0, 102.0, dist);
    float introWave = smoothstep(0.0, 1.0, uIntro * 1.3 - (1.0 - vDepthRatio) * 0.3);

    vec4 clipPos = projectionMatrix * mvPosition;

    // 屏幕空间鼠标推斥与微光点亮
    vec2 ndc = clipPos.xy / max(clipPos.w, 0.0001);
    vec2 diff = ndc - uMouse;
    diff.x *= uAspect;
    float mouseDist = length(diff);
    float repelRadius = 0.26;
    float influence = pow(clamp(1.0 - mouseDist / repelRadius, 0.0, 1.0), 2.0);

    vec2 pushDir = normalize(ndc - uMouse + vec2(1e-5));
    float depthWeight = smoothstep(75.0, 8.0, dist);
    clipPos.xy += pushDir * influence * 0.12 * clipPos.w * depthWeight;

    vMouseGlow = influence * depthWeight;

    // 远处中心的粒子自动压低透明度，彻底解决标题背后的刺眼白带
    float centerAntiGlare = mix(0.25 + 0.75 * vCenterClearance, 1.0, smoothstep(50.0, 15.0, dist));
    vAlpha = nearFade * farFade * introWave * centerAntiGlare;
    if (uIsArena > 0.5) {
      vAlpha *= 0.55; // 闯关模式背景更低调内敛
    }
    vAlpha *= mix(1.0, 0.42, uGalaxy);

    float hoverScale = 1.0 + uHover * 0.35;
    float mouseScale = 1.0 + vMouseGlow * 0.65;

    gl_Position = clipPos;
    float finalSize = aScale * bloomCurve * hoverScale * mouseScale * uPixelRatio * (230.0 / max(dist, 1.0));
    finalSize *= mix(1.0, 0.72, uGalaxy);
    gl_PointSize = clamp(finalSize, 0.0, 44.0);
  }
`;

const valleyFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uHover;
  uniform float uIsArena;
  uniform float uGalaxy;

  varying float vAlpha;
  varying float vMouseGlow;
  varying float vType;
  varying float vSeed;
  varying float vDepthRatio;

  void main() {
    if (vAlpha < 0.01) discard;

    vec2 uv = gl_PointCoord - 0.5;
    float r = length(uv) * 2.0;
    if (r > 1.0) discard;

    // 圆润有机的花瓣光晕，避免画成尖锐刺眼的海星
    float angle = atan(uv.y, uv.x) + vSeed * 6.28 + uTime * 0.2 * uHover;
    float petals = cos(angle * 5.0) * 0.12 + 0.88;

    float shape = 0.0;
    if (vType < 0.5) {
      float core = exp(-r * r * 7.5);
      float corolla = smoothstep(petals, petals * 0.25, r) * 0.55;
      shape = clamp(core + corolla, 0.0, 1.0);
    } else {
      shape = pow(1.0 - r, 2.4);
    }

    vec3 cream = vec3(0.96, 0.937, 0.886);
    vec3 softTeal = vec3(0.28, 0.72, 0.78);
    vec3 warmGold = vec3(0.92, 0.68, 0.42);
    vec3 lilac = vec3(0.55, 0.48, 0.82);
    vec3 mossGreen = vec3(0.12, 0.34, 0.38);
    vec3 deepNight = vec3(0.015, 0.025, 0.05);

    vec3 baseCol;
    if (vType < 0.5) {
      if (vSeed < 0.45) baseCol = mix(warmGold, cream, 0.45);
      else if (vSeed < 0.8) baseCol = mix(softTeal, cream, 0.35);
      else baseCol = mix(lilac, cream, 0.4);
      baseCol = mix(baseCol, cream, exp(-r * r * 8.0) * 0.5);
    } else if (vType < 1.5) {
      baseCol = mix(mossGreen, softTeal * 0.5, vSeed);
    } else {
      baseCol = mix(softTeal, cream, 0.5);
    }

    if (uIsArena > 0.5) {
      baseCol = mix(baseCol, vec3(0.22, 0.52, 0.75), 0.45);
    }
    baseCol = mix(baseCol, vec3(0.10, 0.16, 0.28), uGalaxy * 0.38);

    // 鼠标推开时泛起温暖奶油色光泽，限制最高亮度防止 Bloom 过曝
    baseCol = mix(baseCol, cream * 1.15, clamp(vMouseGlow * 0.9 + uHover * 0.25, 0.0, 1.0));

    // 远景融入夜色深度雾
    baseCol = mix(baseCol, deepNight, smoothstep(0.28, 0.95, vDepthRatio));

    // 降低单点 Alpha 叠加权重，保证数万粒子重叠时依然通透柔和、看清文字
    float finalAlpha = shape * vAlpha * (0.42 + vMouseGlow * 0.35);
    gl_FragColor = vec4(baseCol, finalAlpha);
  }
`;

// ============================================================================
// 3. 丁达尔体积光柱 Shader
// ============================================================================
const lightRayShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform float uTime;
    uniform float uSeed;
    uniform float uGalaxy;
    void main() {
      float beam = sin(vUv.x * 3.14159);
      beam = pow(max(beam, 0.0), 3.0);
      float vFade = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.25, vUv.y);
      float pulse = 0.75 + 0.25 * sin(uTime * 0.5 + uSeed * 6.0);
      vec3 col = mix(vec3(0.18, 0.42, 0.55), vec3(0.96, 0.93, 0.88), vUv.y * 0.4);
      gl_FragColor = vec4(col, beam * vFade * 0.028 * pulse * mix(1.0, 0.22, uGalaxy));
    }
  `,
};

// ============================================================================
// 4. Web Audio 环境音合成器
// ============================================================================
class ValleyAudioController {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  public isInitialized = false;
  public isMuted = true;

  public initAudio() {
    this.isInitialized = true;
  }

  private ensureContext() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioCtx();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.0;

    this.filterNode = this.ctx.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.frequency.value = 1600;
    this.filterNode.Q.value = 0.7;

    this.filterNode.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    const freqs = [65.41, 98.0, 146.83, 196.0];
    freqs.forEach((f, idx) => {
      if (!this.ctx || !this.filterNode) return;
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = f + (Math.random() - 0.5) * 0.35;
      oscGain.gain.value = idx < 2 ? 0.07 : 0.03;
      osc.connect(oscGain);
      oscGain.connect(this.filterNode);
      osc.start();
    });
  }

  public toggleMute(): boolean {
    this.ensureContext();
    if (!this.ctx || !this.masterGain) return true;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    this.isMuted = !this.isMuted;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(this.isMuted ? 0.0 : 0.4, now, 0.4);
    return this.isMuted;
  }

  public setMuffled(muffled: boolean) {
    if (!this.ctx || !this.filterNode) return;
    const now = this.ctx.currentTime;
    this.filterNode.frequency.cancelScheduledValues(now);
    this.filterNode.frequency.setTargetAtTime(muffled ? 260 : 1600, now, 0.35);
  }

  public dispose() {
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

const PALETTES = [
  { a: 0x7ee0d6, b: 0x163a44, dark: 0x061018, rim: 0xd7fbf6 },
  { a: 0xf4c98b, b: 0x6a2a12, dark: 0x140806, rim: 0xffe6c4 },
  { a: 0xb89bff, b: 0x2a1858, dark: 0x0a0618, rim: 0xe8dcff },
  { a: 0x6ee0a8, b: 0x0e3d32, dark: 0x04140f, rim: 0xc9ffe4 },
];

function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function backOut(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function elasticOut(t: number) {
  if (t === 0 || t === 1) return t;
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
}

interface PlanetNode {
  id: string;
  name: string;
  index: number;
  status: string;
  seed: number;
  group: THREE.Group;
  surface: THREE.Mesh;
  atmosphere: THREE.Mesh;
  rings: THREE.Object3D[];
  restScale: number;
  spawnT: number;
  burst: number;
  spin: number;
}

// ============================================================================
// 5. 主场景类 CosmosScene (兼容 wander/arena 双模式与多种构造传参方式)
// ============================================================================
export class CosmosScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private postFXPass: ShaderPass;
  private valleyMaterial: THREE.ShaderMaterial;
  private lightRayMaterials: THREE.ShaderMaterial[] = [];

  public audio = new ValleyAudioController();
  public mode: CosmosMode = 'wander';
  public viewMode: ViewMode = 'landing';

  private rafId = 0;
  private clock = new THREE.Clock();
  private isDisposed = false;

  private scrollZ = 0;
  private scrollVelocity = 0;
  private hoverTarget = 0;
  private hoverCurrent = 0;
  private introProgress = 0;
  private introCompleted = false;
  private reducedMotion = false;
  private galaxyBlend = 0;
  private orbitBlend = 0;

  private mouseTarget = new THREE.Vector2(99, 99);
  private mouseCurrent = new THREE.Vector2(99, 99);
  private touchStartY = 0;
  private lookCurrent = new THREE.Vector3(0, 1.4, -24);
  private ndc = new THREE.Vector3();
  private worldPos = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();

  private galaxyRoot = new THREE.Group();
  private planetSphereGeo = new THREE.SphereGeometry(1.6, 64, 64);
  private planets = new Map<string, PlanetNode>();
  private coreNode: PlanetNode | null = null;
  private portalGroup = new THREE.Group();
  private hoveredId: string | null = null;
  private activeId: string | null = null;
  private galaxyYaw = 0.18;
  private galaxyPitch = 0.12;
  private galaxyDistance = 16;
  private galaxyDistanceTarget = 16;
  private dragging = false;
  private dragMoved = false;
  private dragLast = new THREE.Vector2();
  private scratchPos = new THREE.Vector3();
  private scratchLook = new THREE.Vector3();
  private flyT = 1;
  private flyFromPos = new THREE.Vector3();
  private flyFromLook = new THREE.Vector3();
  private landingEuler = new THREE.Euler();
  private landingQuat = new THREE.Quaternion();
  private aimQuat = new THREE.Quaternion();
  private aimMatrix = new THREE.Matrix4();

  private onLoaded?: () => void;
  private onIntroDone?: () => void;
  private onAnchors?: (anchors: PlanetAnchor[]) => void;
  private onPlanetClick?: (docId: string) => void;
  private onUploadPortalClick?: () => void;

  constructor(
    root: HTMLElement,
    arg2?: (() => void) | CosmosMode | CosmosOptions,
    arg3?: () => void,
    arg4?: CosmosMode
  ) {
    this.container = (root.querySelector('.js-canvas-container') as HTMLElement) || root;

    // 兼容 Cursor 可能生成的任意构造签名：
    // 1. new CosmosScene(root, onLoaded, onIntroDone, 'wander')
    // 2. new CosmosScene(root, { mode: 'arena', onLoaded, onIntroDone })
    // 3. new CosmosScene(root, 'arena')
    if (typeof arg2 === 'function') {
      this.onLoaded = arg2;
      this.onIntroDone = arg3;
      if (arg4) this.mode = arg4;
    } else if (typeof arg2 === 'string') {
      this.mode = arg2;
      this.onLoaded = arg3;
    } else if (arg2 && typeof arg2 === 'object') {
      if (arg2.mode) this.mode = arg2.mode;
      this.onLoaded = arg2.onLoaded;
      this.onIntroDone = arg2.onIntroDone;
      this.onAnchors = arg2.onAnchors;
      this.onPlanetClick = arg2.onPlanetClick;
      this.onUploadPortalClick = arg2.onUploadPortalClick;
      if (arg2.skipIntro) {
        this.introProgress = 1;
        this.introCompleted = true;
      }
    }

    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const width = window.innerWidth;
    const height = window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      powerPreference: 'high-performance',
      antialias: false,
      stencil: false,
      depth: true,
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x020408, 1);
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.4, 260);
    // 抬高相机并微俯视地面，让花谷铺在屏幕中下方，避开中央标题
    this.camera.position.set(0, 2.3, 6);

    this.valleyMaterial = this.createValleyParticles();
    if (this.mode === 'wander') {
      this.createLightRays();
    }
    this.createGalaxyRig();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // 克制柔和的 Bloom 参数，彻底杜绝中心白光糊字
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.52, // strength 适中，发光柔和不刺眼
      0.55, // radius
      0.38  // threshold 提高，只有花蕊与鼠标高亮处泛光
    );
    this.composer.addPass(this.bloomPass);

    this.postFXPass = new ShaderPass(PostFXShader);
    this.composer.addPass(this.postFXPass);

    this.bindEvents();

    requestAnimationFrame(() => {
      this.onLoaded?.();
      this.animate();
    });
  }

  // 直接暴露音频快捷方法，兼容 Cursor 在组件中直接调 scene.initAudio() / scene.toggleMute()
  public initAudio() {
    this.audio.initAudio();
  }

  public toggleMute(): boolean {
    return this.audio.toggleMute();
  }

  public get isAudioInitialized(): boolean {
    return this.audio.isInitialized;
  }

  private createValleyParticles(): THREE.ShaderMaterial {
    const totalCount = this.mode === 'arena' ? 24000 : 45000;
    const geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(totalCount * 3);
    const scales = new Float32Array(totalCount);
    const seeds = new Float32Array(totalCount);
    const types = new Float32Array(totalCount);
    const randomDirs = new Float32Array(totalCount * 3);

    for (let i = 0; i < totalCount; i++) {
      const i3 = i * 3;
      const rand = Math.random();

      // 让粒子偏向山谷两侧分布，减少正中央远处的粒子堆积
      const sideSign = Math.random() < 0.5 ? -1 : 1;
      const lateral = (Math.pow(Math.random(), 0.75) * 32.0 + 0.8) * sideSign;
      const spreadX = Math.random() < 0.25 ? (Math.random() - 0.5) * 12.0 : lateral;
      const spreadY = (Math.random() - 0.5) * 1.4;
      const spreadZ = -Math.random() * 120.0;

      positions[i3] = spreadX;
      positions[i3 + 1] = spreadY;
      positions[i3 + 2] = spreadZ;

      seeds[i] = Math.random();

      if (i < totalCount * 0.62) {
        types[i] = 0.0;
        scales[i] = 0.6 + Math.pow(Math.random(), 2.2) * 1.25;
      } else if (i < totalCount * 0.92) {
        types[i] = 1.0;
        scales[i] = 0.32 + Math.random() * 0.48;
      } else {
        types[i] = 2.0;
        scales[i] = 0.25 + Math.random() * 0.4;
      }

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * rand - 1);
      randomDirs[i3] = Math.sin(phi) * Math.cos(theta);
      randomDirs[i3 + 1] = Math.sin(phi) * Math.sin(theta);
      randomDirs[i3 + 2] = Math.cos(phi);
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aType', new THREE.BufferAttribute(types, 1));
    geometry.setAttribute('aRandomDir', new THREE.BufferAttribute(randomDirs, 3));

    const material = new THREE.ShaderMaterial({
      vertexShader: valleyVertexShader,
      fragmentShader: valleyFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uScrollZ: { value: 0 },
        uHover: { value: 0 },
        uMouse: { value: new THREE.Vector2(99, 99) },
        uAspect: { value: window.innerWidth / window.innerHeight },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uIntro: { value: this.reducedMotion || this.introProgress >= 1 ? 1.0 : 0.0 },
        uIsArena: { value: this.mode === 'arena' ? 1.0 : 0.0 },
        uGalaxy: { value: 0.0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.scene.add(points);

    return material;
  }

  private createLightRays() {
    const planeGeo = new THREE.PlaneGeometry(16, 40);
    const rayConfigs = [
      { x: -14, z: -26, rotZ: -0.22 },
      { x: 15, z: -40, rotZ: 0.24 },
      { x: -10, z: -62, rotZ: -0.18 },
      { x: 17, z: -78, rotZ: 0.2 },
    ];

    rayConfigs.forEach((cfg, idx) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: lightRayShader.vertexShader,
        fragmentShader: lightRayShader.fragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uSeed: { value: idx * 1.7 },
          uGalaxy: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.position.set(cfg.x, 7, cfg.z);
      mesh.rotation.z = cfg.rotZ;
      this.scene.add(mesh);
      this.lightRayMaterials.push(mat);
    });
  }

  private createGalaxyRig() {
    this.galaxyRoot.position.set(0, 2.4, 0);
    this.scene.add(this.galaxyRoot);
    this.coreNode = this.makePlanet({
      id: '__core__',
      name: '原始星核',
      index: 0,
      status: 'dormant',
    }, true);
    this.coreNode.group.position.set(0, 0, 0);
    this.coreNode.restScale = 1.45;
    this.galaxyRoot.add(this.coreNode.group);

    const ringGeo = new THREE.RingGeometry(2.4, 2.48, 96);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf5efe2,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const pulse = new THREE.Mesh(ringGeo, ringMat);
    pulse.rotation.x = Math.PI / 2;
    pulse.userData.kind = 'upload';
    const dash = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 97 }, (_, i) => {
          const a = (i / 96) * Math.PI * 2;
          return new THREE.Vector3(Math.cos(a) * 3.15, 0, Math.sin(a) * 3.15);
        }),
      ),
      new THREE.LineDashedMaterial({
        color: 0x7ee0d6,
        dashSize: 0.28,
        gapSize: 0.18,
        transparent: true,
        opacity: 0.55,
      }),
    );
    dash.computeLineDistances();
    dash.userData.kind = 'upload';
    this.portalGroup.position.set(0, -0.15, 0);
    this.portalGroup.add(pulse, dash);
    this.portalGroup.userData.kind = 'upload';
    this.galaxyRoot.add(this.portalGroup);
  }

  private makePlanet(doc: DocumentItem & { index: number; status: string }, isCore = false): PlanetNode {
    const name = doc.name || doc.filename || doc.id;
    const seed = hash01(doc.id || name);
    const palette = PALETTES[Math.floor(seed * PALETTES.length) % PALETTES.length];
    const restScale = isCore ? 1.45 : 0.92 + seed * 0.42;
    const group = new THREE.Group();
    group.rotation.z = (seed - 0.5) * 0.55;

    const surfaceMat = new THREE.ShaderMaterial({
      vertexShader: planetVertexShader,
      fragmentShader: planetFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: seed },
        uColorA: { value: new THREE.Color(palette.a) },
        uColorB: { value: new THREE.Color(palette.b) },
        uColorDark: { value: new THREE.Color(palette.dark) },
        uRimColor: { value: new THREE.Color(isCore ? 0x8ab4ff : palette.rim) },
        uHover: { value: 0 },
        uBurst: { value: 0 },
        uLightDir: { value: new THREE.Vector3(0.55, 0.35, 0.75).normalize() },
      },
      toneMapped: false,
    });
    const surface = new THREE.Mesh(this.planetSphereGeo, surfaceMat);
    surface.userData.docId = doc.id;
    surface.userData.kind = isCore ? 'core' : 'planet';

    const atmoMat = new THREE.ShaderMaterial({
      vertexShader: atmosphereVertexShader,
      fragmentShader: atmosphereFragmentShader,
      uniforms: {
        uRimColor: { value: new THREE.Color(isCore ? 0xb8d4ff : palette.rim) },
        uHover: { value: 0 },
        uBurst: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      toneMapped: false,
    });
    const atmosphere = new THREE.Mesh(this.planetSphereGeo, atmoMat);
    atmosphere.scale.setScalar(1.08);
    atmosphere.userData.docId = doc.id;

    group.add(surface, atmosphere);

    const rings: THREE.Object3D[] = [];
    const ringCount = isCore ? 1 : seed > 0.42 ? 2 : 1;
    for (let i = 0; i < ringCount; i += 1) {
      const inner = 2.05 + i * 0.38;
      const geo = new THREE.RingGeometry(inner, inner + 0.045, 80);
      const mat = new THREE.MeshBasicMaterial({
        color: palette.rim,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = Math.PI / 2 + (seed - 0.5) * 0.4 + i * 0.18;
      ring.rotation.y = i * 0.5;
      group.add(ring);
      rings.push(ring);

      if (i === 0) {
        const loopPts = Array.from({ length: 65 }, (_, k) => {
          const a = (k / 64) * Math.PI * 2;
          const r = inner + 0.22;
          return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
        });
        const loop = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(loopPts),
          new THREE.LineBasicMaterial({
            color: palette.a,
            transparent: true,
            opacity: 0.25,
          }),
        );
        loop.rotation.copy(ring.rotation);
        group.add(loop);
        rings.push(loop);
      }
    }

    group.scale.setScalar(0.001);
    return {
      id: doc.id,
      name,
      index: doc.index,
      status: doc.status,
      seed,
      group,
      surface,
      atmosphere,
      rings,
      restScale,
      spawnT: 1,
      burst: 0,
      spin: 0.08 + seed * 0.12,
    };
  }

  private layoutPlanet(node: PlanetNode, index: number, total: number) {
    const golden = Math.PI * (3 - Math.sqrt(5));
    const t = index + 0.5;
    const radius = 3.2 + Math.sqrt(t) * (total > 6 ? 2.15 : 2.6);
    const theta = t * golden + node.seed * 0.4;
    node.group.position.set(
      Math.cos(theta) * radius,
      (node.seed - 0.5) * 1.8,
      Math.sin(theta) * radius,
    );
    node.index = index;
  }

  public setCallbacks(partial: Pick<CosmosOptions, 'onAnchors' | 'onPlanetClick' | 'onUploadPortalClick' | 'onIntroDone' | 'onLoaded'>) {
    if (partial.onAnchors) this.onAnchors = partial.onAnchors;
    if (partial.onPlanetClick) this.onPlanetClick = partial.onPlanetClick;
    if (partial.onUploadPortalClick) this.onUploadPortalClick = partial.onUploadPortalClick;
    if (partial.onIntroDone) this.onIntroDone = partial.onIntroDone;
    if (partial.onLoaded) this.onLoaded = partial.onLoaded;
  }

  public setViewMode(mode: ViewMode) {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.flyFromPos.copy(this.camera.position);
    this.flyFromLook.copy(this.lookCurrent);
    this.flyT = 0;
    if (mode !== 'orbit') {
      this.activeId = null;
    }
  }

  public syncPlanets(docs: DocumentItem[], activeDocId?: string) {
    const live = new Set(docs.map((d) => d.id));
    for (const [id, node] of this.planets) {
      if (!live.has(id)) {
        this.galaxyRoot.remove(node.group);
        this.disposePlanetExtras(node);
        this.planets.delete(id);
      }
    }

    docs.forEach((doc, index) => {
      let node = this.planets.get(doc.id);
      if (!node) {
        node = this.makePlanet({
          ...doc,
          index,
          status: doc.status || 'archived',
        });
        this.planets.set(doc.id, node);
        this.galaxyRoot.add(node.group);
        node.spawnT = 1;
        node.group.scale.setScalar(node.restScale);
      } else {
        node.name = doc.name || doc.filename || doc.id;
        node.status = doc.status || node.status;
      }
      this.layoutPlanet(node, index, docs.length);
    });

    if (this.coreNode) {
      this.coreNode.group.visible = docs.length === 0;
    }
    this.portalGroup.visible = true;
    if (activeDocId) {
      this.activeId = activeDocId;
    }
  }

  public spawnPlanetAnimation(newDoc: DocumentItem) {
    const docs = [...this.planets.values()].map((n) => ({
      id: n.id,
      name: n.name,
      status: n.status,
    }));
    if (!docs.some((d) => d.id === newDoc.id)) {
      docs.push({
        id: newDoc.id,
        name: newDoc.name || newDoc.filename || newDoc.id,
        status: newDoc.status || 'archived',
      });
    }
    this.syncPlanets(docs, newDoc.id);
    const node = this.planets.get(newDoc.id);
    if (!node) return;
    node.spawnT = 0;
    node.burst = 1;
    node.group.scale.setScalar(0.001);
    this.focusPlanet(newDoc.id, 'galaxy');
  }

  public focusPlanet(docId: string, after: ViewMode = 'orbit') {
    if (docId === '__core__') {
      this.onUploadPortalClick?.();
      return;
    }
    const node = this.planets.get(docId);
    if (!node) return;
    this.activeId = docId;
    this.viewMode = after;
    this.flyFromPos.copy(this.camera.position);
    this.flyFromLook.copy(this.lookCurrent);
    this.flyT = 0;
    if (after === 'orbit') {
      this.orbitBlend = Math.max(this.orbitBlend, 0.01);
    }
  }

  public getHoveredId() {
    return this.hoveredId;
  }

  public getActiveId() {
    return this.activeId;
  }

  private disposePlanetExtras(node: PlanetNode) {
    node.rings.forEach((ring) => {
      if (ring instanceof THREE.Mesh || ring instanceof THREE.Line) {
        ring.geometry.dispose();
        const mat = ring.material;
        if (!Array.isArray(mat) && mat !== this.planetSphereGeo) {
          mat.dispose();
        }
      }
    });
    (node.surface.material as THREE.Material).dispose();
    (node.atmosphere.material as THREE.Material).dispose();
  }

  private isUiEvent(event: Event) {
    const t = event.target as HTMLElement | null;
    if (!t || typeof t.closest !== 'function') return false;
    return Boolean(
      t.closest('button, a, input, textarea, label, select, .hud-glass, .orbit-hud, .star-label, .glass-panel, .landing-hero, .landing-header, .landing-corner'),
    );
  }

  private pickObject(event: PointerEvent): THREE.Object3D | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const targets: THREE.Object3D[] = [];
    this.planets.forEach((n) => targets.push(n.surface, n.atmosphere));
    if (this.coreNode?.group.visible) targets.push(this.coreNode.surface);
    this.portalGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) targets.push(obj);
    });
    const hits = this.raycaster.intersectObjects(targets, false);
    return hits[0]?.object ?? null;
  }

  public startHoverTransition() {
    this.hoverTarget = 1.0;
    this.audio.setMuffled(true);
  }

  public stopHoverTransition() {
    this.hoverTarget = 0.0;
    this.audio.setMuffled(false);
  }

  private onPointerMove = (e: PointerEvent) => {
    this.mouseTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouseTarget.y = -(e.clientY / window.innerHeight) * 2 + 1;
    if (this.dragging && this.viewMode === 'galaxy') {
      const dx = e.clientX - this.dragLast.x;
      const dy = e.clientY - this.dragLast.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.dragMoved = true;
      this.galaxyYaw += dx * 0.005;
      this.galaxyPitch = THREE.MathUtils.clamp(this.galaxyPitch + dy * 0.003, -0.55, 0.72);
      this.dragLast.set(e.clientX, e.clientY);
    }
    if (this.viewMode === 'galaxy' || this.viewMode === 'orbit') {
      const hit = this.pickObject(e);
      const id = (hit?.userData.docId as string | undefined) ?? null;
      this.hoveredId = id;
      if (hit?.userData.kind === 'upload') {
        this.hoveredId = '__upload__';
      }
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.viewMode !== 'galaxy') return;
    if (e.button !== 0) return;
    if (this.isUiEvent(e)) return;
    this.dragging = true;
    this.dragMoved = false;
    this.dragLast.set(e.clientX, e.clientY);
  };

  private onPointerUp = (e: PointerEvent) => {
    const moved = this.dragMoved;
    this.dragging = false;
    this.dragMoved = false;
    if (this.viewMode === 'landing') return;
    if (this.isUiEvent(e) || moved) return;
    const hit = this.pickObject(e);
    if (!hit) return;
    if (hit.userData.kind === 'upload' || hit.userData.kind === 'core') {
      this.onUploadPortalClick?.();
      return;
    }
    if (hit.userData.docId) {
      this.focusPlanet(hit.userData.docId);
      this.onPlanetClick?.(hit.userData.docId);
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (this.reducedMotion) return;
    if (this.viewMode === 'galaxy') {
      this.galaxyDistanceTarget = THREE.MathUtils.clamp(
        this.galaxyDistanceTarget + e.deltaY * 0.02,
        11,
        28,
      );
      return;
    }
    if (this.viewMode !== 'landing') return;
    this.scrollVelocity += e.deltaY * 0.012;
    this.scrollVelocity = THREE.MathUtils.clamp(this.scrollVelocity, -1.6, 2.2);
  };

  private onTouchStart = (e: TouchEvent) => {
    if (e.touches.length > 0) {
      this.touchStartY = e.touches[0].clientY;
    }
  };

  private onTouchMove = (e: TouchEvent) => {
    if (this.reducedMotion || e.touches.length === 0) return;
    const currentY = e.touches[0].clientY;
    const deltaY = this.touchStartY - currentY;
    this.touchStartY = currentY;
    this.scrollVelocity += deltaY * 0.04;
    this.scrollVelocity = THREE.MathUtils.clamp(this.scrollVelocity, -1.6, 2.2);
  };

  private onResize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.valleyMaterial.uniforms.uAspect.value = width / height;
    this.valleyMaterial.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
  };

  private bindEvents() {
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('touchstart', this.onTouchStart, { passive: true });
    window.addEventListener('touchmove', this.onTouchMove, { passive: true });
    window.addEventListener('resize', this.onResize);
  }

  private animate = () => {
    if (this.isDisposed) return;
    this.rafId = requestAnimationFrame(this.animate);

    const dt = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.getElapsedTime();

    if (this.introProgress < 1.0) {
      this.introProgress = Math.min(1.0, this.introProgress + dt * 0.6);
      if (this.introProgress >= 0.82 && !this.introCompleted) {
        this.introCompleted = true;
        this.onIntroDone?.();
      }
    } else if (!this.introCompleted) {
      this.introCompleted = true;
      this.onIntroDone?.();
    }
    this.valleyMaterial.uniforms.uIntro.value = this.introProgress;

    this.hoverCurrent = THREE.MathUtils.lerp(this.hoverCurrent, this.hoverTarget, dt * 3.5);
    this.mouseCurrent.lerp(this.mouseTarget, dt * 7.0);

    const flightFactor = 1.0 - this.hoverCurrent * 0.9;
    const baseDrift = this.reducedMotion ? 0.0 : 2.4;
    this.scrollZ += (baseDrift * dt + this.scrollVelocity * dt * 14.0) * flightFactor;
    this.scrollVelocity *= Math.pow(0.04, dt);

    const camSwayX = Math.sin(this.scrollZ * 0.028) * 1.4;
    const camSwayY = 2.3 + Math.cos(this.scrollZ * 0.04) * 0.2;
    const mouseInfluenceX = Math.abs(this.mouseCurrent.x) < 10 ? this.mouseCurrent.x : 0;
    const mouseInfluenceY = Math.abs(this.mouseCurrent.y) < 10 ? this.mouseCurrent.y : 0;

    const galaxyTarget = this.viewMode === 'landing' ? 0 : 1;
    const orbitTarget = this.viewMode === 'orbit' ? 1 : 0;
    this.galaxyBlend = THREE.MathUtils.damp(this.galaxyBlend, galaxyTarget, 3.2, dt);
    this.orbitBlend = THREE.MathUtils.damp(this.orbitBlend, orbitTarget, 4.0, dt);
    this.galaxyDistance = THREE.MathUtils.damp(this.galaxyDistance, this.galaxyDistanceTarget, 4.5, dt);

    const landingPos = new THREE.Vector3(
      camSwayX + mouseInfluenceX * 0.75,
      camSwayY + mouseInfluenceY * 0.4,
      6,
    );
    // 与重构前一致：微俯视 -Z，把花谷铺在标题下方，而不是平视深空黑底
    const landingLook = new THREE.Vector3(
      camSwayX * 0.35 + mouseInfluenceX * 0.45,
      landingPos.y - 3.35 + mouseInfluenceY * 0.55,
      -24,
    );

    this.galaxyRoot.rotation.y = THREE.MathUtils.damp(this.galaxyRoot.rotation.y, this.galaxyYaw, 6.0, dt);
    this.galaxyRoot.rotation.x = THREE.MathUtils.damp(this.galaxyRoot.rotation.x, this.galaxyPitch, 6.0, dt);

    const galaxyPos = this.scratchPos.set(0, 6.2, this.galaxyDistance).clone();
    const galaxyLook = this.scratchLook.set(0, 2.2, 0).clone();
    if (this.viewMode === 'galaxy' && this.activeId) {
      const born = this.planets.get(this.activeId);
      if (born) {
        born.group.getWorldPosition(this.worldPos);
        galaxyLook.lerp(this.worldPos, 0.55);
      }
    }

    const orbitPos = galaxyPos.clone();
    const orbitLook = galaxyLook.clone();
    const focused = this.activeId ? this.planets.get(this.activeId) : undefined;
    if (focused) {
      focused.group.getWorldPosition(this.worldPos);
      orbitPos.copy(this.worldPos).add(new THREE.Vector3(-6.4, 1.5, 7.6));
      orbitLook.copy(this.worldPos).add(new THREE.Vector3(-2.2, 0.2, 0.15));
    }

    const highPos = galaxyPos.clone().lerp(orbitPos, this.orbitBlend);
    const highLook = galaxyLook.clone().lerp(orbitLook, this.orbitBlend);
    const desiredPos = landingPos.lerp(highPos, this.galaxyBlend);
    const desiredLook = landingLook.lerp(highLook, this.galaxyBlend);

    if (this.flyT < 1) {
      this.flyT = Math.min(1, this.flyT + dt / 0.8);
      const k = this.flyT * this.flyT * (3 - 2 * this.flyT);
      this.scratchPos.copy(desiredPos);
      this.scratchLook.copy(desiredLook);
      desiredPos.copy(this.flyFromPos).lerp(this.scratchPos, k);
      desiredLook.copy(this.flyFromLook).lerp(this.scratchLook, k);
    }

    this.camera.position.copy(desiredPos);
    this.lookCurrent.copy(desiredLook);
    this.landingEuler.set(
      mouseInfluenceY * 0.04 - 0.09,
      -mouseInfluenceX * 0.06,
      -mouseInfluenceX * 0.025,
    );
    this.landingQuat.setFromEuler(this.landingEuler);
    this.aimMatrix.lookAt(this.camera.position, this.lookCurrent, this.camera.up);
    this.aimQuat.setFromRotationMatrix(this.aimMatrix);
    this.camera.quaternion.copy(this.landingQuat).slerp(this.aimQuat, this.galaxyBlend);

    this.valleyMaterial.uniforms.uTime.value = elapsed;
    this.valleyMaterial.uniforms.uScrollZ.value = this.scrollZ;
    this.valleyMaterial.uniforms.uHover.value = this.hoverCurrent;
    this.valleyMaterial.uniforms.uMouse.value.copy(this.mouseCurrent);
    this.valleyMaterial.uniforms.uGalaxy.value = this.galaxyBlend;
    this.bloomPass.strength = THREE.MathUtils.lerp(0.52, 0.34, this.galaxyBlend);
    this.bloomPass.threshold = THREE.MathUtils.lerp(0.38, 0.44, this.galaxyBlend);

    this.lightRayMaterials.forEach((m) => {
      m.uniforms.uTime.value = elapsed;
      m.uniforms.uGalaxy.value = this.galaxyBlend;
    });

    this.updatePlanets(dt, elapsed);
    this.emitAnchors();

    const normalizedSpeed = THREE.MathUtils.clamp(Math.abs(this.scrollVelocity) * 0.55, 0.0, 1.0);
    this.postFXPass.uniforms.uSpeed.value = normalizedSpeed;
    this.postFXPass.uniforms.uTime.value = elapsed;

    this.composer.render();
  };

  private updatePlanets(dt: number, elapsed: number) {
    const visible = this.galaxyBlend > 0.04;
    this.galaxyRoot.visible = visible;
    this.portalGroup.rotation.y -= dt * 0.35;
    const pulse = 1 + Math.sin(elapsed * 2.2) * 0.04;
    this.portalGroup.scale.setScalar(pulse);

    const bump = (node: PlanetNode) => {
      node.group.rotateY(node.spin * dt);
      node.rings.forEach((ring, i) => {
        ring.rotateZ((i % 2 === 0 ? -1 : 1) * dt * 0.22);
      });
      if (node.spawnT < 1) {
        node.spawnT = Math.min(1, node.spawnT + dt / 1.15);
        const grow = this.reducedMotion
          ? node.spawnT
          : elasticOut(Math.min(1, node.spawnT)) * 0.82 + backOut(Math.min(1, node.spawnT)) * 0.18;
        node.group.scale.setScalar(Math.max(0.001, node.restScale * grow));
        node.burst = Math.max(0, 1 - node.spawnT);
      } else {
        node.group.scale.setScalar(node.restScale);
        node.burst = THREE.MathUtils.damp(node.burst, 0, 4, dt);
      }
      const hover = this.hoveredId === node.id || this.activeId === node.id ? 1 : 0;
      const surfaceMat = node.surface.material as THREE.ShaderMaterial;
      const atmoMat = node.atmosphere.material as THREE.ShaderMaterial;
      surfaceMat.uniforms.uTime.value = elapsed;
      surfaceMat.uniforms.uHover.value = hover;
      surfaceMat.uniforms.uBurst.value = node.burst;
      atmoMat.uniforms.uHover.value = hover;
      atmoMat.uniforms.uBurst.value = node.burst;
    };

    this.planets.forEach(bump);
    if (this.coreNode) bump(this.coreNode);
  }

  private emitAnchors() {
    if (!this.onAnchors) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const anchors: PlanetAnchor[] = [];
    const push = (node: PlanetNode, hide = false) => {
      node.group.getWorldPosition(this.worldPos);
      this.ndc.copy(this.worldPos).project(this.camera);
      const visible = !hide && this.ndc.z > -1 && this.ndc.z < 1 && Math.abs(this.ndc.x) < 1.15 && Math.abs(this.ndc.y) < 1.15;
      anchors.push({
        id: node.id,
        name: node.name,
        index: node.index,
        x: (this.ndc.x * 0.5 + 0.5) * width,
        y: (-this.ndc.y * 0.5 + 0.5) * height,
        visible: visible && this.galaxyBlend > 0.2 && this.orbitBlend < 0.72,
        status: node.status,
      });
    };
    this.planets.forEach((node) => push(node));
    if (this.coreNode?.group.visible) push(this.coreNode);
    this.onAnchors(anchors);
  }

  public dispose() {
    this.isDisposed = true;
    cancelAnimationFrame(this.rafId);

    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchmove', this.onTouchMove);
    window.removeEventListener('resize', this.onResize);

    this.audio.dispose();

    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Points || obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });

    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}