import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const WRAP = 220;
const GROUND_COUNT = 45000;
const DUST_COUNT = 3000;
const IDLE_SPEED = 2.15;

export type CosmosMode = 'wander' | 'arena';
const TOUCH_MULT = 20;

const FLOWER_VERT = /* glsl */ `
uniform float uTime;
uniform float uCamZ;
uniform float uWrap;
uniform float uHover;
uniform float uPixelRatio;
uniform vec3 uCamPos;
uniform vec2 uMouse;

attribute float aSeed;
attribute float aScale;
attribute float aHeight;
attribute float aKind;

varying float vMouseInfluence;
varying float vHeight;
varying float vSeed;
varying float vDist;
varying float vKind;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

void main() {
  float rel = position.z - uCamZ;
  rel = mod(rel + uWrap * 0.5, uWrap) - uWrap * 0.5;
  float worldZ = uCamZ + rel;
  float meander = sin(worldZ * 0.045) * 5.0 + sin(worldZ * 0.011) * 1.6;

  vec3 scatter = vec3(
    hash(aSeed * 1.7) - 0.5,
    hash(aSeed * 3.1) * 0.7 + 0.15,
    hash(aSeed * 5.9) - 0.5
  );
  float spin = uTime * (0.08 + aSeed * 0.12) + aSeed * 12.0;
  float cs = cos(spin * uHover);
  float sn = sin(spin * uHover);
  vec3 floated = vec3(
    scatter.x * cs - scatter.z * sn,
    scatter.y,
    scatter.x * sn + scatter.z * cs
  );

  vec3 world = vec3(
    position.x + meander + floated.x * uHover * 22.0,
    position.y + floated.y * uHover * 16.0 + aKind * 0.4,
    worldZ + floated.z * uHover * 18.0
  );

  vec4 mvPosition = modelViewMatrix * vec4(world, 1.0);
  vec4 clip = projectionMatrix * mvPosition;
  vec2 ndc = clip.xy / max(clip.w, 0.0001);
  vec2 away = ndc - uMouse;
  float md = length(away);
  float push = smoothstep(0.28, 0.0, md);
  vec2 dir = away / max(md, 0.0008);
  clip.xy += dir * push * 0.14 * (1.0 - uHover * 0.25);

  float dist = length(world - uCamPos);
  float nearFade = smoothstep(1.6, 7.2, dist);
  float farGrow = smoothstep(78.0, 11.0, dist);
  float size = mix(6.0, 24.0, aScale) * nearFade * farGrow;
  size *= mix(1.0, 1.04, push);
  size *= mix(1.0, 0.55, aKind);
  gl_PointSize = size * uPixelRatio;
  gl_Position = clip;

  vMouseInfluence = push;
  vHeight = aHeight;
  vSeed = aSeed;
  vDist = dist;
  vKind = aKind;
}
`;

const FLOWER_FRAG = /* glsl */ `
varying float vMouseInfluence;
varying float vHeight;
varying float vSeed;
varying float vDist;
varying float vKind;

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float r = length(uv);
  float ang = atan(uv.y, uv.x);
  float petals = 0.52 + 0.48 * cos(ang * 5.0 + vSeed * 6.2831853);
  float d = r / max(petals, 0.12);
  float flower = 1.0 - smoothstep(0.38, 0.96, d);
  float core = 1.0 - smoothstep(0.0, 0.26, r);
  float star = max(flower, core * 1.15);
  if (star < 0.045) discard;

  vec3 valley = vec3(0.102, 0.169, 0.298);
  vec3 cyan = vec3(0.42, 0.9, 0.82);
  vec3 amber = vec3(0.9, 0.64, 0.26);
  vec3 cream = vec3(0.961, 0.937, 0.886);
  float mixCrown = fract(vSeed * 7.13);
  vec3 crown = mix(cyan, amber, mixCrown);
  vec3   col = mix(valley, crown, smoothstep(-0.6, 7.5, vHeight));
  col = mix(col, cream, clamp(vMouseInfluence * 0.25 + core * 0.12, 0.0, 1.0));
  col = mix(col, cream * 0.85, vKind * 0.35);
  col *= mix(1.0, 0.72, core * (1.0 - vMouseInfluence));

  float fog = smoothstep(78.0, 10.0, vDist);
  float alpha = star * fog * mix(0.82, 0.32, vKind);
  gl_FragColor = vec4(col * (0.32 + core * 0.22 + star * 0.2), alpha);
}
`;

const FX_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.45 },
    uRgb: { value: 0.002 },
    uTime: { value: 0 },
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
    uniform float uVignette;
    uniform float uRgb;
    uniform float uTime;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 fromCenter = uv - 0.5;
      float dist = length(fromCenter);
      vec2 dir = normalize(fromCenter + 0.0001);
      vec4 color;
      color.r = texture2D(tDiffuse, uv + dir * uRgb).r;
      color.g = texture2D(tDiffuse, uv).g;
      color.b = texture2D(tDiffuse, uv - dir * uRgb).b;
      color.a = 1.0;
      float vig = smoothstep(0.95, 0.22, dist * (0.85 + uVignette));
      color.rgb *= vig;
      float grain = (hash(uv * vec2(1920.0, 1080.0) + uTime * 12.0) - 0.5) * 0.045;
      color.rgb += grain;
      gl_FragColor = color;
    }
  `,
};

function terrainHeight(x: number, z: number) {
  const canyon = Math.pow(Math.abs(x) / 18, 2) * 8.2;
  const wave = Math.sin(z * 0.08) * 2.05 + Math.sin(z * 0.031 + x * 0.05) * 1.45;
  const noise = Math.sin(x * 0.4 + z * 0.2) * 0.42 + Math.sin(x * 1.13 + z * 0.07) * 0.16;
  return canyon + wave + noise;
}

function pathX(z: number) {
  return Math.sin(z * 0.045) * 5 + Math.sin(z * 0.011) * 1.6;
}

function createRayTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.Texture();
  }
  const gradient = ctx.createLinearGradient(32, 0, 32, 256);
  gradient.addColorStop(0, 'rgba(245,239,226,0)');
  gradient.addColorStop(0.35, 'rgba(180,220,255,0.22)');
  gradient.addColorStop(0.7, 'rgba(245,239,226,0.08)');
  gradient.addColorStop(1, 'rgba(245,239,226,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

const LEGACY_CHIME_POOL = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 659.25, 783.99];

class CosmosAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = true;
  private muffled = false;
  private chimeTimer: ReturnType<typeof setTimeout> | null = null;
  isInitialized = false;

  initAudio() {
    if (this.ctx) {
      return;
    }
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) {
      return;
    }
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    this.isInitialized = true;
  }

  toggleMute() {
    this.initAudio();
    if (!this.ctx || !this.master) {
      return this.muted;
    }
    void this.ctx.resume();
    this.muted = !this.muted;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.15, now + 0.35);
    if (this.muted) {
      this.stopChimes();
    } else {
      this.scheduleChimes();
    }
    return this.muted;
  }

  setHover(value: number) {
    this.muffled = value > 0.35;
  }

  private stopChimes() {
    if (this.chimeTimer != null) {
      clearTimeout(this.chimeTimer);
      this.chimeTimer = null;
    }
  }

  private scheduleChimes() {
    this.stopChimes();
    const tick = () => {
      if (this.muted || !this.ctx || !this.master) return;
      const count = Math.random() < 0.55 ? 1 : 2;
      const peak = this.muffled ? 0.038 : 0.06;
      const used = new Set<number>();
      for (let i = 0; i < count; i += 1) {
        let idx = Math.floor(Math.random() * LEGACY_CHIME_POOL.length);
        while (used.has(idx) && used.size < LEGACY_CHIME_POOL.length) {
          idx = Math.floor(Math.random() * LEGACY_CHIME_POOL.length);
        }
        used.add(idx);
        this.chime(LEGACY_CHIME_POOL[idx], this.ctx.currentTime + i * 0.08, peak);
      }
      const [lo, hi] = this.muffled ? [2.4, 4.0] : [1.4, 2.6];
      this.chimeTimer = setTimeout(tick, (lo + Math.random() * (hi - lo)) * 1000);
    };
    this.chimeTimer = setTimeout(tick, 180);
  }

  private chime(freq: number, at: number, peak: number) {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 2.28);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(at);
    osc.stop(at + 2.32);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  dispose() {
    this.stopChimes();
    if (this.ctx) {
      void this.ctx.close();
    }
    this.ctx = null;
    this.master = null;
    this.isInitialized = false;
  }
}

export class CosmosScene {
  private root: HTMLElement;
  private canvasHost: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private fxPass: ShaderPass;
  private flowerMat: THREE.ShaderMaterial;
  private rays: THREE.Mesh[] = [];
  private audio = new CosmosAudio();
  private raf = 0;
  private disposed = false;
  private camZ = 0;
  private speed = IDLE_SPEED;
  private targetSpeed = IDLE_SPEED;
  private hover = 0;
  private hoverTarget = 0;
  private mouse = new THREE.Vector2(10, 10);
  private mouseSmoothed = new THREE.Vector2(10, 10);
  private lastT = performance.now();
  private loaded = false;
  private introT = 0;
  private introDone = false;
  private reduceMotion: boolean;
  private onLoaded: () => void;
  private onIntroDone: () => void;
  private skipIntro: boolean;
  private mode: CosmosMode;
  private idleSpeed: number;
  private lastTouchY: number | null = null;

  constructor(
    root: HTMLElement,
    onLoaded: () => void,
    onIntroDone: () => void,
    options: boolean | { skipIntro?: boolean; mode?: CosmosMode } = false,
  ) {
    const opts = typeof options === 'boolean' ? { skipIntro: options, mode: 'wander' as const } : options;
    this.root = root;
    this.onLoaded = onLoaded;
    this.onIntroDone = onIntroDone;
    this.skipIntro = opts.skipIntro ?? false;
    this.mode = opts.mode ?? 'wander';
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.idleSpeed = this.mode === 'arena' ? IDLE_SPEED * 0.32 : IDLE_SPEED;
    this.speed = this.idleSpeed;
    this.targetSpeed = this.reduceMotion ? 0 : this.idleSpeed;

    const host = root.querySelector('.js-canvas-container');
    this.canvasHost = host instanceof HTMLElement ? host : root;

    const width = Math.max(1, this.root.clientWidth);
    const height = Math.max(1, this.root.clientHeight);
    const mobile = Math.min(width, height) < 820;

    const arena = this.mode === 'arena';
    this.scene = new THREE.Scene();
    const bg = arena ? 0x01040c : 0x020308;
    this.scene.background = new THREE.Color(bg);
    this.scene.fog = new THREE.FogExp2(bg, arena ? 0.028 : 0.018);

    this.camera = new THREE.PerspectiveCamera(arena ? 46 : 58, width / height, 0.2, 180);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.25 : 1.75));
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = arena ? 0.62 : 0.82;
    this.canvasHost.appendChild(this.renderer.domElement);

    this.flowerMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCamZ: { value: 0 },
        uWrap: { value: WRAP },
        uHover: { value: 0 },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uCamPos: { value: new THREE.Vector3() },
        uMouse: { value: new THREE.Vector2(10, 10) },
      },
      vertexShader: FLOWER_VERT,
      fragmentShader: FLOWER_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const ground = arena ? (mobile ? 10000 : 18000) : mobile ? 22000 : GROUND_COUNT;
    const dust = arena ? (mobile ? 700 : 1200) : mobile ? 1600 : DUST_COUNT;
    this.scene.add(this.makeField(ground, 0));
    this.scene.add(this.makeField(dust, 1));
    this.addLightRays();

    const renderPass = new RenderPass(this.scene, this.camera);
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      arena ? 0.42 : 0.62,
      0.55,
      arena ? 0.32 : 0.24,
    );
    this.fxPass = new ShaderPass(FX_SHADER);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(bloom);
    this.composer.addPass(this.fxPass);

    this.onPointerMove = this.onPointerMove.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
    this.onResize = this.onResize.bind(this);
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('touchmove', this.onTouchMove, { passive: false });
    window.addEventListener('touchend', this.onTouchEnd, { passive: true });
    window.addEventListener('resize', this.onResize);

    requestAnimationFrame(() => {
      if (this.disposed) {
        return;
      }
      this.loaded = true;
      this.onLoaded();
      if (this.skipIntro || this.reduceMotion) {
        this.introDone = true;
      }
    });

    this.tick();
  }

  startHoverTransition() {
    this.hoverTarget = 1;
    this.targetSpeed = 0;
  }

  stopHoverTransition() {
    this.hoverTarget = 0;
    this.targetSpeed = this.reduceMotion ? 0 : this.idleSpeed;
  }

  initAudio() {
    this.audio.initAudio();
  }

  toggleMute() {
    return this.audio.toggleMute();
  }

  get audioStore() {
    return this.audio;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('touchmove', this.onTouchMove);
    window.removeEventListener('touchend', this.onTouchEnd);
    window.removeEventListener('resize', this.onResize);
    this.flowerMat.dispose();
    this.scene.traverse((obj: THREE.Object3D) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        obj.geometry.dispose();
        const material = obj.material;
        if (Array.isArray(material)) {
          material.forEach((item) => item.dispose());
        } else {
          material.dispose();
        }
      }
    });
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.audio.dispose();
  }

  private makeField(count: number, kind: 0 | 1) {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const scales = new Float32Array(count);
    const heights = new Float32Array(count);
    const kinds = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const z = Math.random() * WRAP;
      const spread = kind === 1 ? 16 : 21;
      const x = (Math.random() * 2 - 1) * spread * (0.35 + Math.random() * 0.65);
      const y = kind === 1
        ? terrainHeight(x, z) + 4 + Math.random() * 9
        : terrainHeight(x, z) + Math.random() * 0.35;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      seeds[i] = Math.random();
      scales[i] = kind === 1 ? 0.25 + Math.random() * 0.4 : 0.35 + Math.random() * 0.65;
      heights[i] = y;
      kinds[i] = kind;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    geo.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
    geo.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
    return new THREE.Points(geo, this.flowerMat);
  }

  private addLightRays() {
    const texture = createRayTexture();
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: 0xcfe6ff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 6; i += 1) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 28), material);
      mesh.rotation.z = (i % 2 === 0 ? -1 : 1) * 0.18;
      mesh.rotation.x = -0.12;
      mesh.userData = {
        baseZ: (i / 6) * WRAP,
        xOff: (i % 2 === 0 ? -1 : 1) * (3.5 + (i % 3)),
      };
      this.rays.push(mesh);
      this.scene.add(mesh);
    }
  }

  private onPointerMove(event: PointerEvent) {
    this.mouse.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
  }

  private onWheel(event: WheelEvent) {
    event.preventDefault();
    if (this.hoverTarget > 0.5) {
      return;
    }
    this.camZ += event.deltaY * 0.018;
    this.speed = THREE.MathUtils.clamp(this.speed + event.deltaY * 0.004, -14, 22);
  }

  private onTouchEnd() {
    this.lastTouchY = null;
  }

  private onTouchMove(event: TouchEvent) {
    if (event.touches.length !== 1) {
      return;
    }
    event.preventDefault();
    const touch = event.touches[0];
    const dy = this.lastTouchY != null ? touch.clientY - this.lastTouchY : 0;
    this.lastTouchY = touch.clientY;
    this.camZ += -dy * 0.04 * TOUCH_MULT;
  }

  private onResize() {
    const width = Math.max(1, this.root.clientWidth);
    const height = Math.max(1, this.root.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.flowerMat.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
  }

  private tick = () => {
    if (this.disposed) {
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;

    this.hover += (this.hoverTarget - this.hover) * (1 - Math.exp(-dt * 3.2));
    this.speed += (this.targetSpeed - this.speed) * (1 - Math.exp(-dt * 1.4));
    if (!this.reduceMotion) {
      this.camZ += this.speed * dt * (1 - this.hover * 0.92);
    }

    this.mouseSmoothed.lerp(this.mouse, 1 - Math.exp(-dt * 6));
    const z = this.camZ;
    const x = pathX(z);
    const arena = this.mode === 'arena';
    const y = (arena ? 3.35 : 5.6) + Math.sin(z * 0.03) * (arena ? 0.2 : 0.35);
    this.camera.position.set(
      x + this.mouseSmoothed.x * (arena ? 0.18 : 0.35),
      y + this.mouseSmoothed.y * (arena ? 0.12 : 0.22),
      z,
    );
    const lookZ = z + (arena ? 8 : 14);
    this.camera.lookAt(pathX(lookZ), arena ? 0.9 : 2.6, lookZ);
    this.camera.rotation.z += this.mouseSmoothed.x * -0.04;

    const t = now * 0.001;
    this.flowerMat.uniforms.uTime.value = t;
    this.flowerMat.uniforms.uCamZ.value = z;
    this.flowerMat.uniforms.uHover.value = this.hover;
    (this.flowerMat.uniforms.uCamPos.value as THREE.Vector3).copy(this.camera.position);
    (this.flowerMat.uniforms.uMouse.value as THREE.Vector2).copy(this.mouseSmoothed);

    this.rays.forEach((ray) => {
      const baseZ = ray.userData.baseZ as number;
      let rel = baseZ - z;
      rel = ((rel + WRAP * 0.5) % WRAP + WRAP) % WRAP - WRAP * 0.5;
      const worldZ = z + rel;
      ray.position.set(pathX(worldZ) + (ray.userData.xOff as number), 7.5, worldZ);
    });

    const speedAmt = Math.min(1, Math.abs(this.speed) / 16);
    this.fxPass.uniforms.uVignette.value = 0.35 + speedAmt * 0.7;
    this.fxPass.uniforms.uRgb.value = 0.0006 + speedAmt * 0.002;
    this.fxPass.uniforms.uTime.value = t;
    this.audio.setHover(this.hover);

    this.composer.render();

    if (this.loaded && !this.introDone) {
      this.introT += dt;
      if (this.introT > 1.35) {
        this.introDone = true;
      }
    }
    if (this.introDone) {
      this.onIntroDone();
    }
  };
}
