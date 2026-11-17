import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import {
  atmosphereFragmentShader,
  atmosphereVertexShader,
  coronaFragmentShader,
  coronaVertexShader,
  planetFragmentShader,
  planetVertexShader,
  progressRingFragmentShader,
  progressRingVertexShader,
} from './planetShaders';
import { COMPLETE_IGNITE, PlanetSurface, type SurfaceZone, type ZoneAnchor } from './planetSurface';
import { getPlanetStage, type ThemePalette } from './planetIdentity';

export type { SurfaceZone, ZoneAnchor, ZoneStatus } from './planetSurface';
export type CosmosMode = 'wander' | 'arena';
export type ViewMode = 'landing' | 'galaxy' | 'orbit' | 'surface';

export type GateSide = 'left' | 'right';
export type GateState = 'pending' | 'crossed' | 'correct' | 'wrong' | 'missed';

/** 地表光门：`correct` 给出时由场景自动判定；不给时等 React 调 `resolveSurfaceGate`。 */
export interface SurfaceGateSpec {
  id: string;
  correct?: GateSide;
  /** 答对后 uTerraform 的增量，默认把剩余荒芜度平均分给所有光门。 */
  gain?: number;
}

export interface SurfaceOptions {
  gates?: SurfaceGateSpec[];
  /** 初始复苏度 0~1。 */
  terraform?: number;
  /** 鉴赏室纯享漫游：不生成光门，uTerraform 固定为 1。 */
  tour?: boolean;
  planetColor?: THREE.ColorRepresentation;
  accentColor?: THREE.ColorRepresentation;
}

/** 每帧推送给 React 的光门屏幕投影，用来摆放门上的短句。 */
export interface GateAnchor {
  gateId: string;
  index: number;
  side: GateSide;
  x: number;
  y: number;
  /** 光门在屏幕上的像素高度，可用于缩放文字。 */
  height: number;
  /** 距离玩家的米数，已穿过为负。 */
  distance: number;
  visible: boolean;
  /** 是否为下一道待选光门。 */
  focus: boolean;
  state: GateState;
  /** 激活后 0.6s 内 0→1 的淡入系数，文字标签应同步乘上。 */
  fade: number;
}

export interface GateCrossEvent {
  gateId: string;
  index: number;
  side: GateSide | null;
  /** 未提供 `correct` 时为 null，需要 React 自行判定。 */
  correct: boolean | null;
}

export interface DocumentItem {
  id: string;
  name?: string;
  filename?: string;
  pages?: number;
  status?: string;
  /** 0~100 总体学习进度，决定 4 档视觉状态 */
  progress?: number;
  planetName?: string;
  themeSummary?: string;
  themePalette?: ThemePalette;
  isPreset?: boolean;
}

export interface PlanetAnchor {
  id: string;
  name: string;
  planetName?: string;
  progress: number;
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
  onZoneClick?: (zoneIndex: number) => void;
  /** 每帧推送当前地表信标的屏幕投影；没有地表时推送空数组。 */
  onZoneAnchors?: (anchors: ZoneAnchor[]) => void;
  /** 地表模式每帧推送左右光门的屏幕投影；离开地表时推送一次空数组。 */
  onGateAnchors?: (anchors: GateAnchor[]) => void;
  onGateCross?: (event: GateCrossEvent) => void;
}

const BASE_FOV = 50;

// 地表世界放在远离星图与花谷的独立区域，相机远平面 260 内互不可见
const SURFACE_ORIGIN = new THREE.Vector3(0, -420, 0);
const SURFACE_SPEED = 16;
const DIVE_SECONDS = 1.0;
const GATE_SLOW_RADIUS = 40;
const GATE_SLOW_FULL = 16;
const GATE_SLOW_FLOOR = 0.25;
const GATE_RECOVER_SECONDS = 0.3;
const GATE_BUFFER_SECONDS = 3.75;
const GATE_LANE_X = 2.4;
const GATE_SPAWN_AHEAD = 90;
const GLIDER_MAX_BANK = THREE.MathUtils.degToRad(25);
const PASS_RING_SECONDS = 0.6;
const GATE_FADE_SECONDS = 0.6;
/** 上一组门落到相机身后（相机在玩家后方 7.4m）才激活下一组 */
const GATE_CLEAR_BEHIND = 9;
const GATE_WIDTH = 3.6;
const GATE_HEIGHT = 4.4;
const GATE_Y = GATE_HEIGHT / 2 + 0.15;
const SHOCKWAVE_SECONDS = 2.6;
const SHOCKWAVE_RADIUS = 80;
const FIELD_SPAN = 220;
const SURFACE_DUST_ALPHA = 0.22;
const CLIMAX_SECONDS = 1.5;
const BASE_LIGHT = new THREE.Vector3(0.55, 0.35, 0.75).normalize();

// ============================================================================
// 1. 后期处理 Shader：柔和 RGB 色差 + 动态暗角 (Vignette) + 胶片微噪点
// ============================================================================
const PostFXShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSpeed: { value: 0.0 },
    uTime: { value: 0.0 },
    uGlitch: { value: 0.0 },
    uFlash: { value: 0.0 },
    uFlashColor: { value: new THREE.Color(0xffffff) },
    uMotion: { value: 1.0 },
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
    uniform float uGlitch;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    uniform float uMotion;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      // 故障条带：横向错位（prefers-reduced-motion 时 uGlitch 恒为 0）
      if (uGlitch > 0.001) {
        float n = hash(vec2(floor(vUv.y * 28.0), floor(uTime * 24.0)));
        uv.x += (n - 0.5) * 0.08 * uGlitch * step(0.62, n);
      }

      vec2 center = uv - 0.5;
      float dist = length(center);

      // 边缘轻微径向色差
      float aberration = dist * dist * (0.005 + uSpeed * 0.012 * uMotion);
      vec2 dir = normalize(center + 1e-5);
      vec2 split = dir * aberration + vec2(uGlitch * 0.012, 0.0);
      float r = texture2D(tDiffuse, uv + split).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - split).b;
      vec3 col = vec3(r, g, b);

      // 柔和暗角，压暗四周突出中心文字
      float vigRadius = 0.82 - uSpeed * 0.15;
      float vig = smoothstep(vigRadius, vigRadius - 0.52, dist);
      col *= mix(0.18, 1.0, vig);

      // 穿越大气层的闪光 / 减弱动态时的淡入淡出
      col = mix(col, uFlashColor, clamp(uFlash, 0.0, 1.0));

      // 微弱胶片颗粒
      float grain = (hash(vUv * 800.0 + uTime) - 0.5) * 0.02;
      col += grain;

      gl_FragColor = vec4(max(col, 0.0), 1.0);
      #include <tonemapping_fragment>
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
  uniform float uSurface;
  uniform float uDustAlpha;

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

    // 地表模式：星尘改为环绕相机的高空天穹，只保留约三成粒子，算力让给地表花海
    float skyKeep = step(aSeed, 0.3);
    if (uSurface > 0.001) {
      vec3 skyDir = normalize(vec3(aRandomDir.x, abs(aRandomDir.y) * 0.9 + 0.1, aRandomDir.z));
      pos = mix(pos, cameraPosition + skyDir * (70.0 + aSeed * 80.0), uSurface);
    }

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
    if (uSurface > 0.001) {
      float twinkle = 0.6 + 0.4 * sin(uTime * (1.5 + aSeed * 4.0) + aSeed * 40.0);
      vAlpha = mix(vAlpha, 0.5 * twinkle * skyKeep, uSurface);
      vDepthRatio = mix(vDepthRatio, 0.15, uSurface);
    }
    vAlpha *= uDustAlpha;

    float hoverScale = 1.0 + uHover * 0.35;
    float mouseScale = 1.0 + vMouseGlow * 0.65;

    gl_Position = clipPos;
    float finalSize = aScale * bloomCurve * hoverScale * mouseScale * uPixelRatio * (230.0 / max(dist, 1.0));
    finalSize *= mix(1.0, 0.72, uGalaxy);
    finalSize = mix(finalSize, aScale * (1.4 + aSeed * 3.0) * uPixelRatio * skyKeep, uSurface);
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
// 3b. 星球地表（surface）：荒芜 → 复苏花海、地面、地平线、全息光门、冲击波环
// ============================================================================
const SURFACE_TERRAIN_GLSL = /* glsl */ `
  float gauss(float x) {
    return exp(-x * x);
  }
  // 中央航道保持平坦，两侧起伏成丘陵
  float terrainHeight(float x, float z) {
    float side = smoothstep(5.5, 24.0, abs(x));
    float hills = sin(x * 0.09 + z * 0.045) * 1.7 + sin(z * 0.11 - x * 0.06) * 0.9 + sin(x * 0.23 + z * 0.19) * 0.35;
    return (hills + 1.2) * side * 1.6 + sin(z * 0.05) * 0.15;
  }
  // 成片分布的苏醒阈值，让花海一块一块绽放而不是均匀变亮
  float patchNoise(float x, float z) {
    return 0.5 + 0.5 * sin(x * 0.13 + sin(z * 0.045) * 2.4) * cos(z * 0.06 + x * 0.04);
  }
  // 冲击波前沿已扫过的位置取新复苏度，未扫到的保持旧值
  float terraformAt(vec2 p, vec4 wave, float fromLevel, float toLevel) {
    float d = length(p - wave.xy);
    float reached = wave.w > 0.0 ? smoothstep(wave.z, wave.z - 5.0, d) : 1.0;
    return mix(fromLevel, toLevel, reached);
  }
`;

const surfaceFieldVertexShader = /* glsl */ `
  attribute float aScale;
  attribute float aSeed;
  attribute float aType; // 0.0: 沉睡花苞, 1.0: 低空浮尘

  uniform float uTime;
  uniform float uTravel;
  uniform float uTerraform;
  uniform float uTerraformFrom;
  uniform vec4 uWave; // x, z, radius, strength
  uniform float uPixelRatio;

  varying float vAlpha;
  varying float vAwake;
  varying float vFront;
  varying float vSeed;
  varying float vType;
  varying float vFog;

  ${SURFACE_TERRAIN_GLSL}

  void main() {
    vType = aType;
    vSeed = aSeed;
    float lead = 30.0;
    float z = uTravel + lead - mod(uTravel + lead - position.z, ${FIELD_SPAN.toFixed(1)});
    float x = position.x;
    float y = terrainHeight(x, z);

    float level = terraformAt(vec2(x, z), uWave, uTerraformFrom, uTerraform);
    float threshold = 0.12 + 0.86 * clamp(patchNoise(x, z) * 0.65 + aSeed * 0.35, 0.0, 1.0);
    vAwake = smoothstep(threshold - 0.1, threshold, level);
    float d = length(vec2(x, z) - uWave.xy);
    vFront = uWave.w * gauss((d - uWave.z) / 3.2);

    if (aType < 0.5) {
      y += 0.12 + position.y * 0.35 + vAwake * 0.25;
      x += sin(uTime * 1.3 + z * 0.3 + aSeed * 6.28) * (0.03 + vAwake * 0.07);
    } else {
      y += 0.6 + mod(position.y * 3.0 + uTime * 0.25 + aSeed * 7.0, 5.0);
    }

    vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
    float dist = -mv.z;
    float nearFade = smoothstep(0.8, 4.0, dist);
    float farFade = 1.0 - smoothstep(110.0, 175.0, dist);
    vFog = smoothstep(40.0, 170.0, dist);

    float body = aType < 0.5 ? 0.16 + 0.74 * vAwake : 0.1 + 0.4 * vAwake;
    // 复苏态单点 alpha 封顶 0.38，远景超过 22m 逐步变淡，防止密集花海叠成白光团
    float alphaCap = mix(0.6, 0.38, max(vAwake, uTerraform));
    float distFade = 1.0 - 0.72 * smoothstep(22.0, 95.0, dist);
    vAlpha = min(body + vFront * 0.5, alphaCap) * distFade * nearFade * farFade;

    gl_Position = projectionMatrix * mv;
    float size = aScale * (0.55 + vAwake * 1.25 + vFront * 1.4) * uPixelRatio * (190.0 / max(dist, 1.0));
    gl_PointSize = clamp(size, 0.0, 40.0);
  }
`;

const surfaceFieldFragmentShader = /* glsl */ `
  uniform vec3 uPlanetColor;
  uniform vec3 uAccentColor;

  varying float vAlpha;
  varying float vAwake;
  varying float vFront;
  varying float vSeed;
  varying float vType;
  varying float vFog;

  void main() {
    if (vAlpha < 0.01) discard;
    vec2 uv = gl_PointCoord - 0.5;
    float r = length(uv) * 2.0;
    if (r > 1.0) discard;

    float shape;
    if (vType < 0.5) {
      float a = atan(uv.y, uv.x) + vSeed * 6.28;
      float petals = cos(a * 5.0) * 0.14 + 0.86;
      float core = exp(-r * r * 8.0);
      float corolla = smoothstep(petals, petals * 0.3, r) * 0.6;
      shape = clamp(core + corolla * vAwake + (1.0 - vAwake) * pow(1.0 - r, 2.5) * 0.6, 0.0, 1.0);
    } else {
      shape = pow(1.0 - r, 2.4);
    }

    vec3 dormant = vec3(0.17, 0.2, 0.27);
    vec3 bloom = mix(uPlanetColor, uAccentColor, step(0.72, vSeed) * 0.85);
    bloom = mix(bloom, vec3(1.0, 0.97, 0.9), exp(-r * r * 9.0) * 0.28);
    vec3 col = mix(dormant, bloom, vAwake);
    col += mix(uPlanetColor, vec3(1.0), 0.35) * vFront * 0.9;
    col = mix(col, vec3(0.02, 0.03, 0.06), vFog * 0.85);
    // 亮度上限：保留色相，只压最高分量，满复苏时也不会被加色混合推成纯白
    float peak = max(max(col.r, col.g), col.b);
    col *= min(1.0, 0.82 / max(peak, 1e-3));
    gl_FragColor = vec4(col, shape * vAlpha);
  }
`;

const surfaceGroundVertexShader = /* glsl */ `
  uniform float uTravel;
  varying vec2 vWorld;
  varying float vDist;

  ${SURFACE_TERRAIN_GLSL}

  void main() {
    vec3 p = position;
    p.z += uTravel - 100.0;
    p.y = terrainHeight(p.x, p.z) - 0.05;
    vWorld = p.xz;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const surfaceGroundFragmentShader = /* glsl */ `
  uniform vec3 uPlanetColor;
  uniform float uTerraform;
  uniform float uTerraformFrom;
  uniform vec4 uWave;
  uniform float uLaneX;
  uniform float uTime;
  varying vec2 vWorld;
  varying float vDist;

  ${SURFACE_TERRAIN_GLSL}

  void main() {
    float level = terraformAt(vWorld, uWave, uTerraformFrom, uTerraform);
    vec2 g = abs(fract(vWorld / 6.0) - 0.5);
    float grid = smoothstep(0.47, 0.5, max(g.x, g.y));
    float lane = gauss((abs(vWorld.x) - uLaneX) / 0.07);
    float lanePulse = 0.6 + 0.4 * sin(vWorld.y * 0.4 + uTime * 3.0);
    vec3 col = vec3(0.012, 0.018, 0.03) + uPlanetColor * 0.05 * level;
    col += uPlanetColor * (grid * 0.05 * (0.4 + level) + lane * 0.13 * lanePulse);
    float d = length(vWorld - uWave.xy);
    col += uPlanetColor * uWave.w * gauss((d - uWave.z) / 2.2) * 0.35;
    col = mix(col, vec3(0.008, 0.012, 0.022), smoothstep(30.0, 170.0, vDist));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const surfaceHorizonFragmentShader = /* glsl */ `
  uniform vec3 uPlanetColor;
  uniform float uTerraform;
  varying vec2 vUv;
  void main() {
    float gy = (vUv.y - 0.22) * 3.5;
    float glow = exp(-gy * gy);
    float sideFade = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
    gl_FragColor = vec4(uPlanetColor, glow * sideFade * (0.1 + 0.22 * uTerraform));
  }
`;

const gateFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec2 uSize;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uFocus;
  uniform float uState; // 0 待选, 1 正确, 2 错误
  uniform float uSeed;
  varying vec2 vUv;

  void main() {
    vec2 m = vUv * uSize;
    vec2 e2 = min(m, uSize - m);
    float edge = min(e2.x, e2.y);
    float border = smoothstep(0.12, 0.0, edge);
    float halo = exp(-edge * 3.0) * 0.35;
    float bracket = step(e2.x, 0.7) * step(e2.y, 0.7) * smoothstep(0.22, 0.05, edge);
    float scan = 0.5 + 0.5 * sin(vUv.y * 90.0 - uTime * 5.0 + uSeed * 3.0);
    float sy = (vUv.y - fract(uTime * 0.4 + uSeed)) * 14.0;
    float sweep = exp(-sy * sy);
    float fill = (0.05 + 0.04 * scan + sweep * 0.12) * (0.6 + uFocus * 0.6);

    vec3 col = mix(uColor, vec3(1.0, 0.32, 0.38), step(1.5, uState));
    float lit = step(0.5, uState) * step(uState, 1.5);
    col = mix(col, mix(uColor, vec3(1.0), 0.4), lit);
    float intensity = border * (0.9 + uFocus * 0.6) + bracket * 0.8 + halo + fill;
    intensity *= 1.0 + lit * 0.8;
    gl_FragColor = vec4(col, clamp(intensity, 0.0, 1.0) * uOpacity);
  }
`;

const gliderTrailVertexShader = /* glsl */ `
  attribute float aFade;
  uniform float uPixelRatio;
  varying float vFade;

  void main() {
    vFade = aFade;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp((1.5 + 5.5 * aFade) * uPixelRatio * (9.0 / max(-mv.z, 0.5)), 0.0, 28.0);
  }
`;

const gliderTrailFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying float vFade;

  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float soft = 1.0 - r * r;
    vec3 col = mix(uColor, vec3(1.0, 0.97, 0.9), vFade * 0.5);
    gl_FragColor = vec4(col, soft * vFade * vFade * 0.55);
  }
`;

const shockwaveFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    if (r > 1.0) discard;
    float b1 = (r - 0.96) / 0.025;
    float b2 = (r - 0.9) / 0.08;
    float band = exp(-b1 * b1) + exp(-b2 * b2) * 0.3;
    float inner = smoothstep(0.2, 0.95, r) * 0.05;
    vec3 col = mix(uColor, vec3(1.0), 0.35);
    gl_FragColor = vec4(col, (band + inner) * uOpacity);
  }
`;

const uvVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ============================================================================
// 4. Web Audio 环境音合成器（全部纯正弦，无噪声缓冲、无锯齿波）
// ============================================================================
const PAD_CUTOFF = 650;
/** C 大调五声音阶 C5 D5 E5 G5 A5 C6 D6 E6 G6 A6，连击越高起始音越高。 */
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0];

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
    this.filterNode.frequency.value = PAD_CUTOFF;
    this.filterNode.Q.value = 0.5;

    this.filterNode.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    // 空灵 Pad：5 个纯正弦组成 Fmaj9 五声和弦，低频组与高频组各由一个极慢 LFO 调制音量，形成错落的呼吸感
    const ctx = this.ctx;
    const filter = this.filterNode;
    const groups = [
      { freqs: [174.61, 220.0, 261.63], level: 0.05, rate: 0.071 },
      { freqs: [329.63, 392.0], level: 0.028, rate: 0.047 },
    ];
    groups.forEach(({ freqs, level, rate }) => {
      const bus = ctx.createGain();
      bus.gain.value = level;
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.value = rate;
      depth.gain.value = level * 0.45;
      lfo.connect(depth);
      depth.connect(bus.gain);
      lfo.start();
      freqs.forEach((f) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f;
        osc.connect(bus);
        osc.start();
      });
      bus.connect(filter);
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
    this.filterNode.frequency.setTargetAtTime(muffled ? 260 : PAD_CUTOFF, now, 0.35);
  }

  // 音效与环境音共用静音开关：默认静音时不出声
  private sfxBus(): AudioContext | null {
    if (this.isMuted || !this.ctx) return null;
    if (!this.sfxGain) {
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.6;
      this.sfxGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private sfxGain: GainNode | null = null;

  /** 一个纯正弦音：attack 秒内升到 peak，再指数衰减到 at + length。 */
  private tone(ctx: AudioContext, freq: number, at: number, length: number, peak: number, attack = 0.008, endFreq?: number) {
    if (!this.sfxGain) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, at);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + length);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }

  /** 章节完成：65.4Hz（C2）纯净低频共鸣 + 523.25Hz（C5）泛音钟声，约 2s。 */
  public playResonanceBoom() {
    const ctx = this.sfxBus();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.tone(ctx, 65.41, now, 2.0, 0.7, 0.12);
    this.tone(ctx, 130.81, now, 1.4, 0.12, 0.12);
    const bell = now + 0.35;
    this.tone(ctx, 523.25, bell, 1.8, 0.16, 0.01);
    this.tone(ctx, 1046.5, bell, 1.1, 0.05, 0.01);
  }

  /** 穿对光门：上升的五声音阶风铃琶音，`combo` 越高起始音越高（C5 → D5 → E5 → G5 …）。 */
  public playGatePass(combo = 1) {
    const ctx = this.sfxBus();
    if (!ctx) return;
    const now = ctx.currentTime;
    const start = Math.max(0, Math.min(combo - 1, PENTATONIC.length - 4));
    for (let k = 0; k < 4; k += 1) {
      const freq = PENTATONIC[start + k];
      const at = now + k * 0.06;
      this.tone(ctx, freq, at, 0.9, 0.11 / (1 + k * 0.25), 0.006);
      this.tone(ctx, freq * 2, at, 0.4, 0.025, 0.004);
    }
  }

  /** 穿错光门：140Hz → 80Hz 柔和深沉的脉冲闷响，180ms。 */
  public playErrorBuzz() {
    const ctx = this.sfxBus();
    if (!ctx) return;
    this.tone(ctx, 140, ctx.currentTime, 0.18, 0.4, 0.01, 80);
  }

  /** 清脆的 1046Hz（C6）短促滴答，30ms。 */
  public playUiTick() {
    const ctx = this.sfxBus();
    if (!ctx) return;
    this.tone(ctx, 1046.5, ctx.currentTime, 0.03, 0.05, 0.002);
  }

  /** 旧接口：打字机滴答。 */
  public playTick() {
    this.playUiTick();
  }

  /** 旧接口：穿门和弦。 */
  public playGateChord() {
    this.playGatePass(1);
  }

  public dispose() {
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.sfxGain = null;
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
  planetName?: string;
  progress: number;
  /** 平滑后的视觉阶段 0 未探索 · 1 探索中 · 2 部分完成 · 3 全部完成 */
  stage: number;
  isCore: boolean;
  decor: PlanetDecor | null;
}

interface PlanetDecor {
  root: THREE.Group;
  dashRing: THREE.LineLoop;
  dashMat: THREE.LineDashedMaterial;
  progressRing: THREE.Mesh;
  progressMat: THREE.ShaderMaterial;
  beacon: THREE.Group;
  beaconMat: THREE.MeshBasicMaterial;
  arcs: THREE.Mesh[];
  arcMat: THREE.MeshBasicMaterial;
  medal: THREE.Group;
  medalMat: THREE.MeshBasicMaterial;
  corona: THREE.Mesh;
  coronaMat: THREE.ShaderMaterial;
}

interface SurfaceGate {
  id: string;
  index: number;
  z: number;
  correct?: GateSide;
  gain?: number;
  group: THREE.Group;
  mats: Record<GateSide, THREE.ShaderMaterial>;
  state: GateState;
  side: GateSide | null;
  crossX: number;
  resolvedT: number;
  active: boolean;
  fadeT: number;
}

const GATE_SIDES: GateSide[] = ['left', 'right'];

const GLOW = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false } as const;

function easeInCubic(t: number) {
  return t * t * t;
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

function surfaceArc(a: THREE.Vector3, b: THREE.Vector3) {
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 28; k += 1) {
    const s = k / 28;
    const d = new THREE.Vector3().lerpVectors(a, b, s).normalize();
    pts.push(d.multiplyScalar(1.6 * (1.015 + Math.sin(Math.PI * s) * 0.07)));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.014, 6, false);
}

/** 星球外围的进度装饰：每档只亮其中一部分，由 updatePlanetStage 按阶段权重淡入淡出。 */
function buildPlanetDecor(seed: number): PlanetDecor {
  const root = new THREE.Group();
  const tilt = (seed - 0.5) * 0.5;

  const dashMat = new THREE.LineDashedMaterial({ color: 0xd7e4ff, dashSize: 0.16, gapSize: 0.14, transparent: true, opacity: 0, depthWrite: false });
  const loop = Array.from({ length: 120 }, (_, k) => {
    const t = (k / 120) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(t) * 2.7, 0, Math.sin(t) * 2.7);
  });
  const dashRing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(loop), dashMat);
  dashRing.computeLineDistances();
  dashRing.rotation.x = tilt;

  const progressMat = new THREE.ShaderMaterial({
    vertexShader: progressRingVertexShader,
    fragmentShader: progressRingFragmentShader,
    uniforms: {
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uCyan: { value: new THREE.Color(0x7ee0d6) },
      uGold: { value: new THREE.Color(0xf4c97a) },
    },
    side: THREE.DoubleSide,
    ...GLOW,
  });
  const progressRing = new THREE.Mesh(new THREE.RingGeometry(2.5, 2.6, 160, 1), progressMat);
  progressRing.rotation.x = -Math.PI / 2 + tilt;

  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xf4c97a, opacity: 0, side: THREE.DoubleSide, ...GLOW });
  const beacon = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.42, 6, 1, true), beaconMat);
  stem.position.y = -0.3;
  beacon.add(
    new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), beaconMat),
    new THREE.Mesh(new THREE.RingGeometry(0.2, 0.235, 40), beaconMat),
    stem,
  );
  beacon.position.y = 2.15;

  const arcMat = new THREE.MeshBasicMaterial({ color: 0xf4c97a, opacity: 0, ...GLOW });
  const dirs = Array.from({ length: 5 }, (_, k) => {
    const a = seed * 6.28 + k * 1.25;
    const e = Math.sin(seed * 9 + k * 1.7) * 0.6;
    return new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).normalize();
  });
  const arcs = dirs.slice(0, 4).map((d, k) => new THREE.Mesh(surfaceArc(d, dirs[k + 1]), arcMat));

  const medalMat = new THREE.MeshBasicMaterial({ color: 0xf4c97a, opacity: 0, side: THREE.DoubleSide, ...GLOW });
  const medal = new THREE.Group();
  const bandA = new THREE.Mesh(new THREE.TorusGeometry(2.32, 0.022, 8, 180), medalMat);
  const bandB = new THREE.Mesh(new THREE.TorusGeometry(2.48, 0.008, 6, 180), medalMat);
  bandA.rotation.x = Math.PI / 2 + tilt * 0.6;
  bandB.rotation.x = Math.PI / 2 + tilt * 0.6 + 0.08;
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), medalMat);
  star.position.y = 2.05;
  star.scale.set(1, 1.8, 1);
  medal.add(bandA, bandB, star);

  const coronaMat = new THREE.ShaderMaterial({
    vertexShader: coronaVertexShader,
    fragmentShader: coronaFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uAmount: { value: 0 },
      uSeed: { value: seed },
      uCoronaColor: { value: new THREE.Color(0xffe6ad) },
    },
    ...GLOW,
  });
  const corona = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 7.6), coronaMat);

  root.add(dashRing, progressRing, beacon, ...arcs, medal, corona);
  return { root, dashRing, dashMat, progressRing, progressMat, beacon, beaconMat, arcs, arcMat, medal, medalMat, corona, coronaMat };
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

  private surface: PlanetSurface | null = null;
  private exploreDocId: string | null = null;
  private exploreBlend = 0;
  private zoneFocus: number | null = null;
  private climaxT = -1;
  private climaxCenter = new THREE.Vector3();
  private basisWorld = new THREE.Matrix4();
  private basisLocal = new THREE.Matrix4();
  private faceQuat = new THREE.Quaternion();
  private parentQuat = new THREE.Quaternion();
  private faceDir = new THREE.Vector3();
  private faceUp = new THREE.Vector3();
  private faceRight = new THREE.Vector3();
  private localUp = new THREE.Vector3();
  private localRight = new THREE.Vector3();
  private exploreLight = new THREE.Vector3();
  private galaxyCenter = new THREE.Vector3();
  private decorQuat = new THREE.Quaternion();

  // 地表漫游（surface）
  private surfaceWorld: THREE.Group | null = null;
  private surfaceShip: THREE.Group | null = null;
  private gliderCore: THREE.Mesh | null = null;
  private gliderTrail: THREE.BufferAttribute | null = null;
  private gliderBank = 0;
  private passRing: THREE.Mesh | null = null;
  private passRingMat: THREE.MeshBasicMaterial | null = null;
  private passRingT = 99;
  private trailPrimed = false;
  private gateCombo = 0;
  private shockwave: THREE.Mesh | null = null;
  private shockwaveMat: THREE.ShaderMaterial | null = null;
  private gateGeo = new THREE.PlaneGeometry(GATE_WIDTH, GATE_HEIGHT);
  private gates: SurfaceGate[] = [];
  private surfaceDocId: string | null = null;
  private surfaceTour = false;
  private surfaceShown = false;
  private diveT = 1;
  private diveFromPos = new THREE.Vector3();
  private diveFromLook = new THREE.Vector3();
  private playerZ = 0;
  private lane = 0;
  private laneX = 0;
  private laneVel = 0;
  private timeScale = 1;
  private sincePass = 99;
  private lastCrossZ = Number.POSITIVE_INFINITY;
  private surfaceTime = 0;
  private terraformTarget = 0;
  private terraformShown = 0;
  private terraformGain = 0;
  private waveT = -1;
  private waveScale = 1;
  private waveCenter = new THREE.Vector2();
  private finaleTarget = 0;
  private finaleRise = 0;
  private shakeT = 99;
  private glitchT = 99;
  private flash = 0;
  private flashColor = new THREE.Color();
  private surfaceRoll = 0;
  private rollQuat = new THREE.Quaternion();
  private gateAnchorsEmpty = true;
  private surfaceU = {
    uTime: { value: 0 },
    uTravel: { value: 0 },
    uTerraform: { value: 0 },
    uTerraformFrom: { value: 0 },
    uWave: { value: new THREE.Vector4(0, 0, 0, 0) },
    uPlanetColor: { value: new THREE.Color(0x7ee0d6) },
    uAccentColor: { value: new THREE.Color(0xf4c98b) },
    uPixelRatio: { value: 1 },
    uLaneX: { value: GATE_LANE_X },
  };

  private onLoaded?: () => void;
  private onIntroDone?: () => void;
  private onAnchors?: (anchors: PlanetAnchor[]) => void;
  private onPlanetClick?: (docId: string) => void;
  private onUploadPortalClick?: () => void;
  private onZoneClick?: (zoneIndex: number) => void;
  private onZoneAnchors?: (anchors: ZoneAnchor[]) => void;
  private onGateAnchors?: (anchors: GateAnchor[]) => void;
  private onGateCross?: (event: GateCrossEvent) => void;

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
      this.onZoneClick = arg2.onZoneClick;
      this.onZoneAnchors = arg2.onZoneAnchors;
      this.onGateAnchors = arg2.onGateAnchors;
      this.onGateCross = arg2.onGateCross;
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
    // 电影级高光压制：多层 AdditiveBlending 叠加时不溢出成惨白；由最终的 PostFX 屏幕 pass 执行
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.88;
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
    this.postFXPass.uniforms.uMotion.value = this.reducedMotion ? 0 : 1;
    this.composer.addPass(this.postFXPass);
    this.surfaceU.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);

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
        uSurface: { value: 0.0 },
        uDustAlpha: { value: 1.0 },
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
        uColorAccent: { value: new THREE.Color(0xf4c98b) },
        uCoronaColor: { value: new THREE.Color(0xffe6ad) },
        uHover: { value: 0 },
        uBurst: { value: 0 },
        uProgress: { value: 0 },
        uStage: { value: isCore ? 1 : 0 },
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
        uCoronaColor: { value: new THREE.Color(0xffe6ad) },
        uHover: { value: 0 },
        uBurst: { value: 0 },
        uStage: { value: isCore ? 1 : 0 },
        uTime: { value: 0 },
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

    const decor = isCore ? null : buildPlanetDecor(seed);
    if (decor) group.add(decor.root);

    group.scale.setScalar(0.001);
    const node: PlanetNode = {
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
      planetName: doc.planetName,
      progress: Math.max(0, Math.min(100, doc.progress ?? 0)),
      stage: isCore ? 1 : 0,
      isCore,
      decor,
    };
    if (doc.themePalette) this.applyTheme(node, doc.themePalette);
    return node;
  }

  /** 换上文档的主题配色（冷青鎏金 / 星云紫琥珀 / 荧光翡翠 / 暖奶油赤陶）。 */
  private applyTheme(node: PlanetNode, theme: ThemePalette) {
    const s = (node.surface.material as THREE.ShaderMaterial).uniforms;
    const a = (node.atmosphere.material as THREE.ShaderMaterial).uniforms;
    (s.uColorA.value as THREE.Color).set(theme.primary);
    (s.uColorB.value as THREE.Color).set(theme.surfaceB);
    (s.uColorDark.value as THREE.Color).set(theme.dark);
    (s.uRimColor.value as THREE.Color).set(theme.rim);
    (s.uColorAccent.value as THREE.Color).set(theme.accent);
    (s.uCoronaColor.value as THREE.Color).set(theme.corona);
    (a.uRimColor.value as THREE.Color).set(theme.rim);
    (a.uCoronaColor.value as THREE.Color).set(theme.corona);
    node.rings.forEach((ring) => {
      const mat = (ring as THREE.Mesh).material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial;
      if (mat && 'color' in mat) mat.color.set(theme.rim);
    });
    if (node.decor) {
      node.decor.arcMat.color.set(theme.accent);
      (node.decor.coronaMat.uniforms.uCoronaColor.value as THREE.Color).set(theme.corona);
    }
  }

  /** 区域进度变化时直接更新星球外观，不重排星图、不打断相机。 */
  public setPlanetProgress(docId: string, progress: number) {
    const node = this.planets.get(docId);
    if (node) node.progress = Math.max(0, Math.min(100, Math.round(progress)));
  }

  /** 按 progress 驱动 4 档外观：暗淡虚线 → 呼吸进度环 → 局部点亮 + 能量弧 → 日冕 + 成就星环。 */
  private updatePlanetStage(node: PlanetNode, dt: number, elapsed: number) {
    const s = (node.surface.material as THREE.ShaderMaterial).uniforms;
    const a = (node.atmosphere.material as THREE.ShaderMaterial).uniforms;
    a.uTime.value = elapsed;
    if (node.isCore) return;
    const stage = getPlanetStage(node.progress, this.activeId === node.id);
    const target = stage === 'completed' ? 3 : stage === 'partial' ? 2 : stage === 'exploring' ? 1 : 0;
    node.stage = this.reducedMotion ? target : THREE.MathUtils.damp(node.stage, target, 3.2, dt);
    const p = node.progress / 100;
    s.uStage.value = node.stage;
    s.uProgress.value = p;
    a.uStage.value = node.stage;

    const d = node.decor;
    if (!d) return;
    const show = 1 - this.exploreBlend;
    const w = (c: number) => Math.max(0, 1 - Math.abs(node.stage - c)) * show;
    const breath = 0.5 + 0.5 * Math.sin(elapsed * 2.6 + node.seed * 6.28);

    d.dashMat.opacity = 0.34 * w(0);
    d.dashRing.visible = d.dashMat.opacity > 0.01;
    d.dashRing.rotation.y += dt * 0.05;

    const ring = Math.max(w(1), w(2));
    d.progressMat.uniforms.uOpacity.value = ring;
    d.progressMat.uniforms.uProgress.value = p;
    d.progressMat.uniforms.uTime.value = elapsed;
    d.progressRing.visible = ring > 0.01;

    d.beaconMat.opacity = w(1) * (0.5 + breath * 0.5);
    d.beacon.visible = d.beaconMat.opacity > 0.01;
    d.beacon.scale.setScalar(0.9 + breath * 0.2);
    d.beacon.rotation.y += dt * 1.4;
    d.beacon.position.y = 2.15 + Math.sin(elapsed * 1.6) * 0.06;

    const arcAmt = Math.max(w(2), w(3));
    const lit = node.stage >= 2.5 ? d.arcs.length : Math.max(1, Math.round(p * d.arcs.length));
    d.arcs.forEach((arc, i) => {
      arc.visible = arcAmt > 0.01 && i < lit;
    });
    d.arcMat.opacity = arcAmt * (0.55 + 0.3 * Math.sin(elapsed * 3 + node.seed * 4));

    d.medalMat.opacity = 0.85 * w(3);
    d.medal.visible = d.medalMat.opacity > 0.01;
    d.medal.rotation.y += dt * 0.18;

    d.coronaMat.uniforms.uAmount.value = w(3);
    d.coronaMat.uniforms.uTime.value = elapsed;
    d.corona.visible = w(3) > 0.01;
    if (d.corona.visible) {
      node.group.getWorldQuaternion(this.decorQuat).invert();
      d.corona.quaternion.copy(this.decorQuat).multiply(this.camera.quaternion);
    }
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

  public setCallbacks(
    partial: Partial<
      Pick<
        CosmosOptions,
        | 'onAnchors'
        | 'onPlanetClick'
        | 'onUploadPortalClick'
        | 'onIntroDone'
        | 'onLoaded'
        | 'onZoneClick'
        | 'onZoneAnchors'
        | 'onGateAnchors'
        | 'onGateCross'
      >
    >,
  ) {
    if ('onGateAnchors' in partial) this.onGateAnchors = partial.onGateAnchors;
    if ('onGateCross' in partial) this.onGateCross = partial.onGateCross;
    if (partial.onAnchors) this.onAnchors = partial.onAnchors;
    if (partial.onPlanetClick) this.onPlanetClick = partial.onPlanetClick;
    if (partial.onUploadPortalClick) this.onUploadPortalClick = partial.onUploadPortalClick;
    if (partial.onIntroDone) this.onIntroDone = partial.onIntroDone;
    if (partial.onLoaded) this.onLoaded = partial.onLoaded;
    if ('onZoneClick' in partial) this.onZoneClick = partial.onZoneClick;
    if ('onZoneAnchors' in partial) this.onZoneAnchors = partial.onZoneAnchors;
  }

  // --------------------------------------------------------------------------
  // 星球地表知识区域（阶段 2）
  // --------------------------------------------------------------------------

  /** 为某颗星球铺设地表信标。同一文档、同一组区域时只同步状态，不打断正在播放的序列。 */
  public setSurfaceZones(docId: string, zones: SurfaceZone[]) {
    const same =
      this.surface?.docId === docId &&
      this.surface.ids.length === zones.length &&
      this.surface.ids.every((id, i) => id === zones[i].id);
    if (same && this.surface) {
      this.surface.setStatuses(zones);
      return;
    }
    this.clearSurfaceZones();
    if (zones.length === 0) return;
    this.surface = new PlanetSurface(docId, zones, this.renderer.getPixelRatio());
    this.attachSurface();
  }

  public clearSurfaceZones() {
    this.surface?.dispose();
    this.surface = null;
  }

  /** 进入/离开地表探索：相机贴近并把星球摆到左侧，星球停止自转、把区域群转向镜头。 */
  public setExploreMode(docId: string | null) {
    this.exploreDocId = docId;
    if (!docId) this.zoneFocus = null;
  }

  public setZoneFocus(index: number | null) {
    this.zoneFocus = index;
  }

  /** 迷雾坍缩 + 信标 BackOut 升起 + 能量线生长，2.0s。 */
  public unlockZoneSequence(zoneIndex: number) {
    this.surface?.unlockZone(zoneIndex, this.reducedMotion);
  }

  /** 全屏点亮：相机蓄力推拉、球面脉冲环、Bloom 冲高、低频共鸣，1.5s。 */
  public completeZoneSequence(zoneIndex: number) {
    if (!this.surface) return;
    this.surface.completeZone(zoneIndex, this.reducedMotion);
    this.audio.playResonanceBoom();
    if (this.reducedMotion) return;
    const node = this.planets.get(this.surface.docId);
    if (node) node.group.getWorldPosition(this.climaxCenter);
    this.climaxT = 0;
  }

  public getZoneAnchors(): ZoneAnchor[] {
    if (!this.surface) return [];
    return this.surface.anchors(this.camera, window.innerWidth, window.innerHeight, this.surface.root.visible);
  }

  private attachSurface() {
    if (!this.surface) return;
    const node = this.planets.get(this.surface.docId);
    if (node && this.surface.root.parent !== node.group) {
      node.group.add(this.surface.root);
    }
  }

  public setViewMode(mode: ViewMode) {
    if (this.viewMode === mode) return;
    const prev = this.viewMode;
    this.viewMode = mode;
    if (mode === 'surface') {
      const docId = this.surfaceDocId ?? this.activeId;
      if (docId && docId !== this.surfaceDocId) this.resetSurface(docId, {});
      this.beginDive();
      return;
    }
    this.beginFlyFrom(prev);
    if (mode !== 'orbit') {
      this.activeId = null;
    }
  }

  /** 离开地表时从星球大气外侧起飞，否则从当前相机位置起飞。 */
  private beginFlyFrom(prev: ViewMode) {
    if (prev === 'surface') {
      this.leaveSurface();
    } else {
      this.flyFromPos.copy(this.camera.position);
      this.flyFromLook.copy(this.lookCurrent);
    }
    this.flyT = 0;
  }

  // --------------------------------------------------------------------------
  // 星球地表漫游（surface）
  // --------------------------------------------------------------------------

  /** 降落到某颗星球地表：1.0s 大气层俯冲后进入低空滑行。 */
  public enterSurface(docId: string, options: SurfaceOptions = {}) {
    this.resetSurface(docId, options);
    if (this.viewMode === 'surface') this.beginDive();
    else this.setViewMode('surface');
  }

  public exitSurface(mode: ViewMode = 'orbit') {
    if (this.viewMode === 'surface') this.setViewMode(mode === 'surface' ? 'orbit' : mode);
  }

  /** 按顺序沿航道铺设光门；每两道之间保留约 3.75s 全速纯飞行缓冲带。 */
  public setSurfaceGates(specs: SurfaceGateSpec[]) {
    this.ensureSurfaceWorld();
    this.gates.forEach((g) => {
      this.surfaceWorld?.remove(g.group);
      GATE_SIDES.forEach((s) => g.mats[s].dispose());
    });
    this.gates = [];
    this.terraformGain = specs.length > 0 ? (1 - this.terraformTarget) / specs.length : 0;
    const lead = GATE_SLOW_RADIUS + SURFACE_SPEED * GATE_BUFFER_SECONDS;
    const gap = GATE_SLOW_RADIUS + SURFACE_SPEED * (GATE_RECOVER_SECONDS + GATE_BUFFER_SECONDS);
    specs.forEach((spec, index) => {
      const gate = this.makeGate(spec, index, this.playerZ - lead - index * gap);
      this.gates.push(gate);
      this.surfaceWorld?.add(gate.group);
    });
  }

  /** 接在最后一道光门之后继续铺设（重试题、下一区域），间距规则与 `setSurfaceGates` 相同。 */
  public appendSurfaceGates(specs: SurfaceGateSpec[]) {
    this.ensureSurfaceWorld();
    this.gates = this.gates.filter((g) => {
      const stale = g.state !== 'pending' && this.playerZ - g.z < -30;
      if (stale) {
        this.surfaceWorld?.remove(g.group);
        GATE_SIDES.forEach((s) => g.mats[s].dispose());
      }
      return !stale;
    });
    const lead = GATE_SLOW_RADIUS + SURFACE_SPEED * GATE_BUFFER_SECONDS;
    const gap = GATE_SLOW_RADIUS + SURFACE_SPEED * (GATE_RECOVER_SECONDS + GATE_BUFFER_SECONDS);
    const last = this.gates[this.gates.length - 1];
    const start = last ? Math.min(this.playerZ - lead, last.z - gap) : this.playerZ - lead;
    specs.forEach((spec, k) => {
      const gate = this.makeGate(spec, this.gates.length, start - k * gap);
      this.gates.push(gate);
      this.surfaceWorld?.add(gate.group);
    });
  }

  /** 100% 同步率高潮：清空光门、整片花海一次绽放，镜头拉升俯瞰。 */
  public playSurfaceFinale() {
    if (this.viewMode !== 'surface') return;
    this.setSurfaceGates([]);
    this.finaleTarget = 1;
    this.raiseTerraform(1, this.laneX, this.playerZ, 2.2);
    this.audio.playResonanceBoom();
  }

  /** 鉴赏室纯享漫游：不再有光门，复苏度锁定为 1，镜头回到低空滑行。 */
  public startSurfaceTour() {
    this.surfaceTour = true;
    this.setSurfaceGates([]);
    this.terraformTarget = 1;
    this.finaleTarget = 0;
  }

  /** React 自行判题时调用；场景已自动判定过的光门会被忽略。 */
  public resolveSurfaceGate(gateId: string, correct: boolean) {
    const gate = this.gates.find((g) => g.id === gateId);
    if (gate) this.resolveGate(gate, correct);
  }

  /** 直接设定复苏度；地表可见且允许动效时从玩家位置释放冲击波。 */
  public setTerraform(value: number, animate = true) {
    const v = THREE.MathUtils.clamp(value, 0, 1);
    if (animate && this.surfaceShown) {
      this.raiseTerraform(v, this.laneX, this.playerZ);
      return;
    }
    this.terraformTarget = v;
    this.terraformShown = v;
    this.waveT = -1;
  }

  /** 触屏按钮等非键盘输入用来变道。 */
  public steerSurface(side: GateSide) {
    this.lane = side === 'left' ? -1 : 1;
  }

  public getSurfaceState() {
    return {
      terraform: this.terraformTarget,
      timeScale: this.timeScale,
      lane: this.lane,
      travelled: -this.playerZ,
      gatesLeft: this.gates.filter((g) => g.state === 'pending').length,
    };
  }

  private resetSurface(docId: string, options: SurfaceOptions) {
    this.ensureSurfaceWorld();
    this.surfaceDocId = docId;
    if (this.planets.has(docId)) this.activeId = docId;
    this.surfaceTour = !!options.tour;
    this.playerZ = 0;
    this.lane = 0;
    this.laneX = 0;
    this.laneVel = 0;
    this.timeScale = 1;
    this.sincePass = 99;
    this.lastCrossZ = Number.POSITIVE_INFINITY;
    this.trailPrimed = false;
    this.passRingT = 99;
    this.gliderBank = 0;
    this.gateCombo = 0;
    const start = this.surfaceTour ? 1 : THREE.MathUtils.clamp(options.terraform ?? 0, 0, 1);
    this.terraformTarget = start;
    this.terraformShown = start;
    this.waveT = -1;
    this.finaleTarget = 0;
    this.finaleRise = 0;

    const node = this.planets.get(docId);
    const s = node ? (node.surface.material as THREE.ShaderMaterial).uniforms : null;
    this.surfaceU.uPlanetColor.value.set(options.planetColor ?? (s ? (s.uColorA.value as THREE.Color) : 0x7ee0d6));
    this.surfaceU.uAccentColor.value.set(options.accentColor ?? (s ? (s.uColorAccent.value as THREE.Color) : 0xf4c98b));
    this.setSurfaceGates(this.surfaceTour ? [] : options.gates ?? []);
  }

  private beginDive() {
    this.ensureSurfaceWorld();
    this.diveT = 0;
    this.flyT = 1;
    this.diveFromPos.copy(this.camera.position);
    this.diveFromLook.copy(this.lookCurrent);
    if (this.reducedMotion) this.flashColor.setRGB(0.008, 0.012, 0.022);
    else this.flashColor.copy(this.surfaceU.uPlanetColor.value).lerp(new THREE.Color(1, 1, 1), 0.55);
  }

  private leaveSurface() {
    this.diveT = 1;
    this.surfaceShown = false;
    if (this.surfaceWorld) this.surfaceWorld.visible = false;
    this.shakeT = 99;
    this.glitchT = 99;
    this.surfaceRoll = 0;
    this.finaleTarget = 0;
    this.finaleRise = 0;
    const node = this.surfaceDocId ? this.planets.get(this.surfaceDocId) : undefined;
    if (node) {
      node.group.getWorldPosition(this.worldPos);
      this.galaxyRoot.getWorldPosition(this.galaxyCenter);
      const dir = this.worldPos.clone().sub(this.galaxyCenter);
      dir.y = 0;
      if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
      dir.normalize();
      dir.y = 0.35;
      dir.normalize();
      this.flyFromPos.copy(this.worldPos).addScaledVector(dir, 1.6 * node.group.scale.x * 1.15);
      this.flyFromLook.copy(this.worldPos);
    } else {
      this.flyFromPos.set(0, 6.2, this.galaxyDistance);
      this.flyFromLook.set(0, 2.2, 0);
    }
    this.lookCurrent.copy(this.flyFromLook);
    this.flash = 1;
  }

  private ensureSurfaceWorld() {
    if (this.surfaceWorld) return;
    const world = new THREE.Group();
    world.position.copy(SURFACE_ORIGIN);
    world.visible = false;

    const count = 26000;
    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const seeds = new Float32Array(count);
    const types = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const lateral = Math.random() < 0.2 ? (Math.random() - 0.5) * 9 : side * (1.2 + Math.pow(Math.random(), 0.8) * 58);
      positions[i * 3] = lateral;
      positions[i * 3 + 1] = Math.random();
      positions[i * 3 + 2] = Math.random() * FIELD_SPAN;
      seeds[i] = Math.random();
      const flower = i < count * 0.82;
      types[i] = flower ? 0 : 1;
      scales[i] = flower ? 0.55 + Math.pow(Math.random(), 2.2) * 1.2 : 0.25 + Math.random() * 0.35;
    }
    const fieldGeo = new THREE.BufferGeometry();
    fieldGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    fieldGeo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    fieldGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    fieldGeo.setAttribute('aType', new THREE.BufferAttribute(types, 1));
    const field = new THREE.Points(
      fieldGeo,
      new THREE.ShaderMaterial({
        vertexShader: surfaceFieldVertexShader,
        fragmentShader: surfaceFieldFragmentShader,
        uniforms: { ...this.surfaceU },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    field.frustumCulled = false;
    field.renderOrder = 1;

    const groundGeo = new THREE.PlaneGeometry(140, 260, 70, 130);
    groundGeo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.ShaderMaterial({
        vertexShader: surfaceGroundVertexShader,
        fragmentShader: surfaceGroundFragmentShader,
        uniforms: { ...this.surfaceU },
      }),
    );
    ground.frustumCulled = false;

    const horizon = new THREE.Mesh(
      new THREE.PlaneGeometry(700, 160),
      new THREE.ShaderMaterial({
        vertexShader: uvVertexShader,
        fragmentShader: surfaceHorizonFragmentShader,
        uniforms: { ...this.surfaceU },
        ...GLOW,
      }),
    );
    horizon.name = 'horizon';
    horizon.position.y = 40;

    const ship = this.createGlider(world);

    this.shockwaveMat = new THREE.ShaderMaterial({
      vertexShader: uvVertexShader,
      fragmentShader: shockwaveFragmentShader,
      uniforms: { uColor: this.surfaceU.uPlanetColor, uOpacity: { value: 0 } },
      side: THREE.DoubleSide,
      ...GLOW,
    });
    const ringGeo = new THREE.PlaneGeometry(2, 2);
    ringGeo.rotateX(-Math.PI / 2);
    this.shockwave = new THREE.Mesh(ringGeo, this.shockwaveMat);
    this.shockwave.visible = false;
    this.shockwave.renderOrder = 2;

    world.add(ground, field, horizon, ship, this.shockwave);
    this.surfaceShip = ship;
    this.surfaceWorld = world;
    this.scene.add(world);
  }

  /** 流光星灵滑翔器：发光晶体核心 + 对称光翼 + 粒子尾迹；另建一圈穿门加速光波。 */
  private createGlider(world: THREE.Group): THREE.Group {
    const color = this.surfaceU.uPlanetColor.value;
    const glider = new THREE.Group();

    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff8ec, opacity: 0.95, ...GLOW });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), coreMat);
    core.scale.set(0.75, 0.75, 1.7);
    const haloMat = new THREE.MeshBasicMaterial({ opacity: 0.32, ...GLOW });
    haloMat.color = color;
    const halo = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), haloMat);
    halo.scale.set(0.8, 0.6, 1.5);

    // 后掠三角光翼，左翼由右翼镜像
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0.1, 0, -0.32, 1.05, 0.06, 0.42, 0.16, 0, 0.3, 0.1, 0, -0.32, 0.62, 0.03, 0.36, 0.16, 0, 0.3], 3),
    );
    const wingMat = new THREE.MeshBasicMaterial({ opacity: 0.55, side: THREE.DoubleSide, ...GLOW });
    wingMat.color = color;
    const rightWing = new THREE.Mesh(wingGeo, wingMat);
    const leftWing = new THREE.Mesh(wingGeo, wingMat);
    leftWing.scale.x = -1;

    const trailCount = 42;
    const trailPos = new Float32Array(trailCount * 3);
    const trailFade = new Float32Array(trailCount);
    for (let i = 0; i < trailCount; i += 1) trailFade[i] = 1 - i / trailCount;
    const trailGeo = new THREE.BufferGeometry();
    const trailAttr = new THREE.BufferAttribute(trailPos, 3);
    trailAttr.setUsage(THREE.DynamicDrawUsage);
    trailGeo.setAttribute('position', trailAttr);
    trailGeo.setAttribute('aFade', new THREE.BufferAttribute(trailFade, 1));
    const trail = new THREE.Points(
      trailGeo,
      new THREE.ShaderMaterial({
        vertexShader: gliderTrailVertexShader,
        fragmentShader: gliderTrailFragmentShader,
        uniforms: { uColor: this.surfaceU.uPlanetColor, uPixelRatio: this.surfaceU.uPixelRatio },
        ...GLOW,
      }),
    );
    trail.frustumCulled = false;

    glider.add(halo, core, rightWing, leftWing);
    world.add(trail);
    this.gliderCore = core;
    this.gliderTrail = trailAttr;

    this.passRingMat = new THREE.MeshBasicMaterial({ opacity: 0, side: THREE.DoubleSide, ...GLOW });
    this.passRingMat.color = color;
    this.passRing = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), this.passRingMat);
    this.passRing.visible = false;
    world.add(this.passRing);
    return glider;
  }

  /** 每帧：侧倾压弯（最大 ±25°）、悬浮呼吸、晶体自转、尾迹推进、穿门光波扩散。 */
  private updateGlider(dt: number) {
    const ship = this.surfaceShip;
    if (!ship) return;
    const hover = Math.sin(this.surfaceTime * 2.1) * (this.reducedMotion ? 0.03 : 0.08);
    ship.position.set(this.laneX, 1.2 + hover, this.playerZ);
    const bankTarget = THREE.MathUtils.clamp(-this.laneVel * 0.07, -GLIDER_MAX_BANK, GLIDER_MAX_BANK);
    this.gliderBank = THREE.MathUtils.damp(this.gliderBank, this.reducedMotion ? bankTarget * 0.4 : bankTarget, 8, dt);
    ship.rotation.set(Math.sin(this.surfaceTime * 1.3) * 0.03, -this.laneVel * 0.015, this.gliderBank);
    if (this.gliderCore) this.gliderCore.rotation.z += dt * 1.6;

    const trail = this.gliderTrail;
    if (trail) {
      const arr = trail.array as Float32Array;
      if (!this.trailPrimed) {
        for (let i = 0; i < arr.length; i += 3) {
          arr[i] = ship.position.x;
          arr[i + 1] = ship.position.y;
          arr[i + 2] = ship.position.z + 0.45;
        }
        this.trailPrimed = true;
      }
      arr.copyWithin(3, 0, arr.length - 3);
      arr[0] = ship.position.x;
      arr[1] = ship.position.y - 0.02;
      arr[2] = ship.position.z + 0.45;
      trail.needsUpdate = true;
    }

    if (this.passRing && this.passRingMat) {
      this.passRingT += dt;
      const p = this.passRingT / PASS_RING_SECONDS;
      this.passRing.visible = p < 1;
      if (p < 1) {
        const grow = this.reducedMotion ? 1.6 : 0.6 + easeOutCubic(p) * 4.2;
        this.passRing.scale.setScalar(grow);
        this.passRing.position.set(ship.position.x, ship.position.y, this.passRing.position.z);
        this.passRingMat.opacity = (1 - p) * 0.75;
      }
    }
  }

  /** React 在 onGateCross 回调里同步当前连击数；连击越高，答对时的复苏波纹越大、风铃起音越高。 */
  public setGateCombo(combo: number) {
    this.gateCombo = Math.max(0, Math.floor(combo));
  }

  private makeGate(spec: SurfaceGateSpec, index: number, z: number): SurfaceGate {
    const group = new THREE.Group();
    group.position.set(0, 0, z);
    group.visible = false;
    const mats = {} as Record<GateSide, THREE.ShaderMaterial>;
    GATE_SIDES.forEach((side, k) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: uvVertexShader,
        fragmentShader: gateFragmentShader,
        uniforms: {
          uTime: this.surfaceU.uTime,
          uColor: this.surfaceU.uPlanetColor,
          uSize: { value: new THREE.Vector2(GATE_WIDTH, GATE_HEIGHT) },
          uOpacity: { value: 0 },
          uFocus: { value: 0 },
          uState: { value: 0 },
          uSeed: { value: index * 1.37 + k * 0.5 },
        },
        side: THREE.DoubleSide,
        ...GLOW,
      });
      const mesh = new THREE.Mesh(this.gateGeo, mat);
      mesh.position.set((side === 'left' ? -1 : 1) * GATE_LANE_X, GATE_Y, 0);
      group.add(mesh);
      mats[side] = mat;
    });
    return {
      id: spec.id,
      index,
      z,
      correct: spec.correct,
      gain: spec.gain,
      group,
      mats,
      state: 'pending',
      side: null,
      crossX: 0,
      active: false,
      fadeT: 0,
      resolvedT: 0,
    };
  }

  /** 当前挑战的光门：只有已激活的那一组才参与减速、穿门判定和投影。 */
  private nextPendingGate(): SurfaceGate | null {
    const gate = this.gates.find((g) => g.state === 'pending');
    return gate && gate.active ? gate : null;
  }

  /** 单组显隐：上一组门完全落到相机身后，才在前方 90m 激活下一组并淡入。 */
  private activateNextGate() {
    const gate = this.gates.find((g) => g.state === 'pending');
    if (!gate || gate.active) return;
    if (this.playerZ > this.lastCrossZ - GATE_CLEAR_BEHIND) return;
    gate.active = true;
    gate.fadeT = 0;
    gate.z = this.playerZ - GATE_SPAWN_AHEAD;
    gate.group.position.z = gate.z;
    GATE_SIDES.forEach((s) => {
      gate.mats[s].uniforms.uOpacity.value = 0;
    });
  }

  private crossGate(gate: SurfaceGate) {
    const side: GateSide | null = this.laneX < -0.6 ? 'left' : this.laneX > 0.6 ? 'right' : null;
    gate.side = side;
    gate.crossX = this.laneX;
    gate.state = 'crossed';
    this.sincePass = 0;
    this.lastCrossZ = gate.z;
    this.passRingT = 0;
    if (this.passRing) this.passRing.position.z = gate.z;
    const correct = gate.correct ? side === gate.correct : null;
    this.onGateCross?.({ gateId: gate.id, index: gate.index, side, correct });
    if (correct !== null && gate.state === 'crossed') this.resolveGate(gate, correct);
  }

  private resolveGate(gate: SurfaceGate, correct: boolean) {
    if (gate.state !== 'crossed' && gate.state !== 'pending') return;
    gate.resolvedT = 0;
    if (correct) {
      gate.state = 'correct';
      const combo = Math.max(1, this.gateCombo);
      const spread = 1 + 0.25 * Math.min(combo - 1, 4);
      this.raiseTerraform(this.terraformTarget + (gate.gain ?? this.terraformGain), gate.crossX, gate.z, spread);
      this.audio.playGatePass(combo);
      return;
    }
    gate.state = gate.side ? 'wrong' : 'missed';
    this.audio.playErrorBuzz();
    if (!this.reducedMotion) {
      this.shakeT = 0;
      this.glitchT = 0;
    }
  }

  private raiseTerraform(target: number, x: number, z: number, scale = 1) {
    const to = THREE.MathUtils.clamp(target, 0, 1);
    this.surfaceU.uTerraformFrom.value = this.terraformShown;
    this.terraformTarget = to;
    if (this.reducedMotion) return;
    this.waveT = 0;
    this.waveScale = scale;
    this.waveCenter.set(x, z);
  }

  /** 每帧推进地表；不在地表时返回 0，否则改写相机位姿并返回本帧 FOV。 */
  private updateSurface(dt: number, pos: THREE.Vector3, look: THREE.Vector3): number {
    this.shakeT += dt;
    this.glitchT += dt;
    if (this.viewMode !== 'surface') {
      this.flash = Math.max(0, this.flash - dt / 0.55);
      this.surfaceShown = false;
      if (this.surfaceWorld) this.surfaceWorld.visible = false;
      return 0;
    }
    const world = this.surfaceWorld;
    if (!world) return 0;

    if (this.diveT < 1) this.diveT = Math.min(1, this.diveT + dt / DIVE_SECONDS);
    const t = this.diveT;
    this.surfaceShown = t >= 0.5;
    world.visible = this.surfaceShown;

    // 时间膨胀：进入下一道光门 40m 内 smoothstep 降到 25%，穿门后 0.3s 平滑回到 100%
    if (t >= 1) this.activateNextGate();
    const next = this.nextPendingGate();
    let approach = 0;
    if (next) approach = 1 - THREE.MathUtils.smoothstep(this.playerZ - next.z, GATE_SLOW_FULL, GATE_SLOW_RADIUS);
    const approachScale = 1 - (1 - GATE_SLOW_FLOOR) * approach;
    const recoverScale =
      GATE_SLOW_FLOOR + (1 - GATE_SLOW_FLOOR) * THREE.MathUtils.smoothstep(this.sincePass, 0, GATE_RECOVER_SECONDS);
    this.timeScale = t >= 1 ? Math.min(approachScale, recoverScale) : 1;
    this.sincePass += dt;
    const dilation = (1 - this.timeScale) / (1 - GATE_SLOW_FLOOR);

    this.finaleRise = this.reducedMotion
      ? this.finaleTarget
      : THREE.MathUtils.damp(this.finaleRise, this.finaleTarget, 1.1, dt);
    if (t >= 1) {
      const prevZ = this.playerZ;
      this.playerZ -= SURFACE_SPEED * this.timeScale * (1 - 0.7 * this.finaleRise) * dt;
      if (next && prevZ > next.z && this.playerZ <= next.z) this.crossGate(next);
    }
    // 变道用真实时间，子弹时间里也跟手
    const prevX = this.laneX;
    this.laneX = THREE.MathUtils.damp(this.laneX, this.lane * GATE_LANE_X, 6, dt);
    this.laneVel = dt > 0 ? (this.laneX - prevX) / dt : 0;
    this.surfaceTime += dt * this.timeScale;

    this.updateTerraform(dt);
    this.updateGates(dt, next, approach);

    const u = this.surfaceU;
    u.uTime.value = this.surfaceTime;
    u.uTravel.value = this.playerZ;
    const horizon = world.getObjectByName('horizon');
    if (horizon) horizon.position.z = this.playerZ - 215;

    const roll = THREE.MathUtils.clamp(-this.laneVel * 0.12, -0.5, 0.5);
    this.updateGlider(dt);
    this.surfaceRoll = this.reducedMotion ? 0 : roll * 0.3;

    const glidePos = new THREE.Vector3(this.laneX * 0.82, 2.55 + Math.sin(this.surfaceTime * 0.9) * 0.06, this.playerZ + 7.4).add(SURFACE_ORIGIN);
    const glideLook = new THREE.Vector3(this.laneX * 0.5, 1.25, this.playerZ - 26).add(SURFACE_ORIGIN);
    // 子弹时间：FOV 微收聚焦
    const glideFov = BASE_FOV + 4 - 7 * dilation;
    let fov = glideFov;

    if (t < 1) {
      const node = this.surfaceDocId ? this.planets.get(this.surfaceDocId) : undefined;
      if (t < 0.5) {
        // 俯冲：冲向星球大气层
        const k = easeInCubic(t / 0.5);
        pos.copy(this.diveFromPos);
        look.copy(this.diveFromLook);
        if (node && !this.reducedMotion) {
          node.group.getWorldPosition(this.worldPos);
          const entry = this.diveFromPos.clone().sub(this.worldPos).normalize()
            .multiplyScalar(1.6 * node.group.scale.x * 1.12).add(this.worldPos);
          pos.lerp(entry, k);
          look.lerp(this.worldPos, Math.min(1, k * 1.6));
          fov = BASE_FOV + 14 * k;
        } else {
          fov = BASE_FOV;
        }
      } else {
        // 穿出云层：从高空压低到滑行高度
        const e = easeOutCubic((t - 0.5) / 0.5);
        if (this.reducedMotion) {
          pos.copy(glidePos);
          look.copy(glideLook);
        } else {
          pos.copy(glidePos).add(new THREE.Vector3(0, 30, 16)).lerp(glidePos, e);
          look.set(glideLook.x, SURFACE_ORIGIN.y, glideLook.z - 4).lerp(glideLook, e);
          fov = THREE.MathUtils.lerp(BASE_FOV + 14, glideFov, e);
        }
      }
      this.flash = this.reducedMotion
        ? THREE.MathUtils.clamp(1 - Math.abs(t - 0.5) / 0.5, 0, 1)
        : THREE.MathUtils.clamp(1 - Math.abs(t - 0.5) / 0.2, 0, 1) ** 1.5;
    } else {
      pos.copy(glidePos);
      look.copy(glideLook);
      this.flash = 0;
      if (this.finaleRise > 0.001) {
        // 高潮：镜头拉升到高空俯瞰整片绽放的花海
        const r = this.finaleRise;
        pos.y += 58 * r;
        pos.z += 34 * r;
        look.lerp(this.scratchLook.set(this.laneX * 0.3, 0, this.playerZ - 60).add(SURFACE_ORIGIN), r);
        fov += 10 * r;
      }
    }

    if (!this.reducedMotion && this.shakeT < 0.35) {
      const amp = 0.12 * (1 - this.shakeT / 0.35);
      pos.x += Math.sin(this.shakeT * 83) * amp;
      pos.y += Math.sin(this.shakeT * 61 + 1.1) * amp * 0.7;
    }
    return fov;
  }

  private updateTerraform(dt: number) {
    const u = this.surfaceU;
    const wave = u.uWave.value;
    if (this.reducedMotion) {
      // 减弱动态：不放冲击波，整片花海按透明度柔和过渡
      this.terraformShown = THREE.MathUtils.damp(this.terraformShown, this.terraformTarget, 2.5, dt);
      u.uTerraformFrom.value = this.terraformShown;
      u.uTerraform.value = this.terraformShown;
      wave.w = 0;
      if (this.shockwave) this.shockwave.visible = false;
      return;
    }
    u.uTerraform.value = this.terraformTarget;
    if (this.waveT < 0) {
      this.terraformShown = this.terraformTarget;
      u.uTerraformFrom.value = this.terraformTarget;
      wave.w = 0;
      if (this.shockwave) this.shockwave.visible = false;
      return;
    }
    this.waveT += dt;
    const p = Math.min(1, this.waveT / (SHOCKWAVE_SECONDS * Math.sqrt(this.waveScale)));
    const radius = Math.max(0.5, SHOCKWAVE_RADIUS * this.waveScale * easeOutCubic(p));
    const strength = Math.min(1, this.waveT / 0.12) * (1 - p);
    wave.set(this.waveCenter.x, this.waveCenter.y, radius, strength);
    this.terraformShown = THREE.MathUtils.lerp(u.uTerraformFrom.value as number, this.terraformTarget, p);
    if (this.shockwave && this.shockwaveMat) {
      this.shockwave.visible = true;
      this.shockwave.position.set(this.waveCenter.x, 0.35, this.waveCenter.y);
      this.shockwave.scale.setScalar(radius);
      this.shockwaveMat.uniforms.uOpacity.value = strength;
    }
    if (p >= 1) this.waveT = -1;
  }

  private updateGates(dt: number, next: SurfaceGate | null, approach: number) {
    for (const gate of this.gates) {
      if (!gate.active) {
        gate.group.visible = false;
        continue;
      }
      gate.resolvedT += dt;
      gate.fadeT += dt;
      const ahead = this.playerZ - gate.z;
      const fadeIn = THREE.MathUtils.smoothstep(gate.fadeT, 0, GATE_FADE_SECONDS);
      const behind = ahead < 0 ? 1 - THREE.MathUtils.smoothstep(-ahead, 0, GATE_CLEAR_BEHIND) : 1;
      const base = fadeIn * behind;
      gate.group.visible = base > 0.01;
      if (!gate.group.visible) continue;
      const failed = gate.state === 'wrong' || gate.state === 'missed';
      GATE_SIDES.forEach((side) => {
        const u = gate.mats[side].uniforms;
        let state = 0;
        let dim = 1;
        if (gate.state === 'correct') {
          state = side === gate.side ? 1 : 0;
          dim = side === gate.side ? 1 : 0.3;
        } else if (failed) {
          if (side === gate.side) state = 2;
          else if (side === gate.correct) state = 1;
          if (this.reducedMotion && side === gate.side) dim = 0.35;
          else if (!this.reducedMotion && side === gate.side && gate.resolvedT < 0.45) {
            dim = Math.sin(gate.resolvedT * 90) > 0 ? 1 : 0.25;
          }
        }
        u.uState.value = state;
        u.uFocus.value = gate === next ? approach : 0;
        u.uOpacity.value = gate.fadeT < GATE_FADE_SECONDS
          ? base * dim
          : THREE.MathUtils.damp(u.uOpacity.value as number, base * dim, this.reducedMotion ? 4 : 12, dt);
      });
    }
  }

  private emitGateAnchors() {
    if (!this.onGateAnchors) return;
    if (!this.surfaceShown || this.gates.length === 0) {
      if (!this.gateAnchorsEmpty) this.onGateAnchors([]);
      this.gateAnchorsEmpty = true;
      return;
    }
    const width = window.innerWidth;
    const height = window.innerHeight;
    const next = this.nextPendingGate();
    const anchors: GateAnchor[] = [];
    for (const gate of this.gates) {
      if (gate !== next || !gate.group.visible) continue;
      const distance = this.playerZ - gate.z;
      GATE_SIDES.forEach((side) => {
        const x = (side === 'left' ? -1 : 1) * GATE_LANE_X;
        this.worldPos.set(x, GATE_Y, gate.z).add(SURFACE_ORIGIN);
        this.ndc.copy(this.worldPos).project(this.camera);
        const sx = (this.ndc.x * 0.5 + 0.5) * width;
        const sy = (-this.ndc.y * 0.5 + 0.5) * height;
        const visible = this.ndc.z > -1 && this.ndc.z < 1 && Math.abs(this.ndc.x) < 1.2 && Math.abs(this.ndc.y) < 1.2;
        this.scratchPos.set(x, GATE_Y + GATE_HEIGHT / 2, gate.z).add(SURFACE_ORIGIN).project(this.camera);
        const top = (-this.scratchPos.y * 0.5 + 0.5) * height;
        anchors.push({
          gateId: gate.id,
          index: gate.index,
          side,
          x: sx,
          y: sy,
          height: Math.abs(sy - top) * 2,
          distance,
          visible,
          focus: gate === next,
          state: gate.state,
          fade: THREE.MathUtils.smoothstep(gate.fadeT, 0, GATE_FADE_SECONDS),
        });
      });
    }
    this.gateAnchorsEmpty = anchors.length === 0;
    this.onGateAnchors(anchors);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.viewMode !== 'surface') return;
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
      this.steerSurface('left');
      e.preventDefault();
    } else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
      this.steerSurface('right');
      e.preventDefault();
    }
  };

  public syncPlanets(docs: DocumentItem[], activeDocId?: string) {
    const live = new Set(docs.map((d) => d.id));
    for (const [id, node] of this.planets) {
      if (!live.has(id)) {
        if (this.surface?.docId === id) this.clearSurfaceZones();
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
        if (doc.planetName) node.planetName = doc.planetName;
        if (typeof doc.progress === 'number') node.progress = Math.max(0, Math.min(100, doc.progress));
        if (doc.themePalette) this.applyTheme(node, doc.themePalette);
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
    this.attachSurface();
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
    if (after === 'surface') {
      this.enterSurface(docId);
      return;
    }
    const prev = this.viewMode;
    this.activeId = docId;
    this.viewMode = after;
    this.beginFlyFrom(prev);
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
    node.decor?.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
  }

  private isUiEvent(event: Event) {
    const t = event.target as HTMLElement | null;
    if (!t || typeof t.closest !== 'function') return false;
    return Boolean(
      t.closest('button, a, input, textarea, label, select, .hud-glass, .orbit-hud, .star-label, .glass-panel, .landing-hero, .landing-header, .landing-corner, .zone-capsule, .zone-label, .gallery-panel, .gallery-tour'),
    );
  }

  private pickObject(event: PointerEvent): THREE.Object3D | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    if (this.surface?.root.visible) {
      const zoneHit = this.raycaster.intersectObjects(this.surface.pickTargets(), false)[0];
      if (zoneHit) return zoneHit.object;
    }
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
      const overZone = hit?.userData.kind === 'zone';
      this.renderer.domElement.style.cursor = overZone ? 'pointer' : '';
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
    if (this.viewMode === 'landing' || this.viewMode === 'surface') return;
    if (this.isUiEvent(e) || moved) return;
    const hit = this.pickObject(e);
    if (!hit) return;
    if (hit.userData.kind === 'zone') {
      this.onZoneClick?.(hit.userData.zoneIndex as number);
      return;
    }
    if (this.exploreDocId) return;
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
    this.surfaceU.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
  };

  private bindEvents() {
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('touchstart', this.onTouchStart, { passive: true });
    window.addEventListener('touchmove', this.onTouchMove, { passive: true });
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
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

    const exploring = this.viewMode === 'orbit' && !!focused && this.exploreDocId === this.activeId;
    this.exploreBlend = THREE.MathUtils.damp(this.exploreBlend, exploring ? 1 : 0, 3.0, dt);
    if (focused && this.exploreBlend > 0.001) {
      // 从星系中心向外看向星球：其他星球落在身后，不挡镜头；星球偏左给右侧任务舱让位
      const s = focused.restScale;
      this.galaxyRoot.getWorldPosition(this.galaxyCenter);
      const outward = this.worldPos.clone().sub(this.galaxyCenter);
      outward.y = 0;
      if (outward.lengthSq() < 1e-4) outward.set(0, 0, 1);
      outward.normalize();
      const right = new THREE.Vector3().crossVectors(outward.clone().negate(), this.camera.up).normalize();
      // ≤820px 时任务舱是底部抽屉：星球居中并抬到上半屏，而不是左移
      const narrow = window.innerWidth <= 820;
      const explorePos = this.worldPos.clone().addScaledVector(outward, (3.9 * s + 2.2) * (narrow ? 1.5 : 1));
      explorePos.y += 0.75 * s;
      const exploreLook = this.worldPos.clone().addScaledVector(right, narrow ? 0 : 1.9 * s);
      exploreLook.y -= narrow ? 1.5 * s : 0.05;
      orbitPos.lerp(explorePos, this.exploreBlend);
      orbitLook.lerp(exploreLook, this.exploreBlend);
    }

    const highPos = galaxyPos.clone().lerp(orbitPos, this.orbitBlend);
    const highLook = galaxyLook.clone().lerp(orbitLook, this.orbitBlend);
    const desiredPos = landingPos.lerp(highPos, this.galaxyBlend);
    const desiredLook = landingLook.lerp(highLook, this.galaxyBlend);

    const surfaceFov = this.updateSurface(dt, desiredPos, desiredLook);

    if (this.flyT < 1 && surfaceFov === 0) {
      this.flyT = Math.min(1, this.flyT + dt / 0.8);
      const k = this.flyT * this.flyT * (3 - 2 * this.flyT);
      this.scratchPos.copy(desiredPos);
      this.scratchLook.copy(desiredLook);
      desiredPos.copy(this.flyFromPos).lerp(this.scratchPos, k);
      desiredLook.copy(this.flyFromLook).lerp(this.scratchLook, k);
    }

    const climax = this.advanceClimax(dt);
    let fov = surfaceFov > 0 ? surfaceFov : BASE_FOV;
    if (climax >= 0) {
      // 0 → 0.45s 蓄力下潜；随后点亮脉冲把镜头弹性推回（略越过原位再回稳）
      const env = climax < COMPLETE_IGNITE
        ? (1 - Math.cos((climax / COMPLETE_IGNITE) * Math.PI)) / 2
        : 1 - elasticOut(Math.min(1, (climax - COMPLETE_IGNITE) / (CLIMAX_SECONDS - COMPLETE_IGNITE)));
      const toPlanet = this.climaxCenter.clone().sub(desiredPos).normalize();
      desiredPos.addScaledVector(toPlanet, 0.6 * env);
      const shakeAmp = 0.03 * (climax < COMPLETE_IGNITE
        ? climax / COMPLETE_IGNITE
        : Math.max(0, 1 - (climax - COMPLETE_IGNITE) / (CLIMAX_SECONDS - COMPLETE_IGNITE)));
      desiredPos.x += Math.sin(climax * 53) * shakeAmp;
      desiredPos.y += Math.sin(climax * 71 + 1.3) * shakeAmp * 0.8;
      fov = BASE_FOV - 2 * env;
    }
    if (Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
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
    if (this.surfaceShown && this.surfaceRoll !== 0) {
      this.rollQuat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.surfaceRoll);
      this.camera.quaternion.multiply(this.rollQuat);
    }

    this.valleyMaterial.uniforms.uTime.value = elapsed;
    this.valleyMaterial.uniforms.uScrollZ.value = this.scrollZ;
    this.valleyMaterial.uniforms.uHover.value = this.hoverCurrent;
    this.valleyMaterial.uniforms.uMouse.value.copy(this.mouseCurrent);
    this.valleyMaterial.uniforms.uGalaxy.value = this.galaxyBlend;
    // 渲染预算互斥：地表模式把背景星尘压到 0.22，GPU 让给花海与光门
    this.valleyMaterial.uniforms.uSurface.value = this.surfaceShown ? 1 : 0;
    this.valleyMaterial.uniforms.uDustAlpha.value = THREE.MathUtils.damp(
      this.valleyMaterial.uniforms.uDustAlpha.value as number,
      this.viewMode === 'surface' ? SURFACE_DUST_ALPHA : 1,
      6,
      dt,
    );
    // 地表 Bloom 随复苏度动态平衡：花越多，泛光越弱、阈值越高，满复苏也不刺眼
    const terraformK = THREE.MathUtils.clamp(this.terraformShown, 0, 1);
    const baseBloom = this.surfaceShown
      ? THREE.MathUtils.lerp(0.52, 0.32, terraformK)
      : THREE.MathUtils.lerp(0.52, 0.34, this.galaxyBlend);
    this.bloomPass.strength = baseBloom;
    this.bloomPass.threshold = this.surfaceShown
      ? THREE.MathUtils.lerp(0.38, 0.55, terraformK)
      : THREE.MathUtils.lerp(0.38, 0.44, this.galaxyBlend);
    if (climax >= COMPLETE_IGNITE) {
      // 点亮后 0.3s 冲到 1.1，再回落到 0.52，最后回归当前视图基线
      const t = climax - COMPLETE_IGNITE;
      if (t < 0.3) this.bloomPass.strength = THREE.MathUtils.lerp(baseBloom, 1.1, t / 0.3);
      else if (t < 0.75) this.bloomPass.strength = THREE.MathUtils.lerp(1.1, 0.52, (t - 0.3) / 0.45);
      else this.bloomPass.strength = THREE.MathUtils.lerp(0.52, baseBloom, Math.min(1, (t - 0.75) / 0.3));
    }

    this.lightRayMaterials.forEach((m) => {
      m.uniforms.uTime.value = elapsed;
      m.uniforms.uGalaxy.value = this.galaxyBlend;
    });

    this.updatePlanets(dt, elapsed);
    this.emitAnchors();
    this.onZoneAnchors?.(this.getZoneAnchors());
    this.emitGateAnchors();

    const normalizedSpeed = THREE.MathUtils.clamp(Math.abs(this.scrollVelocity) * 0.55, 0.0, 1.0);
    const fx = this.postFXPass.uniforms;
    // 地表：子弹时间收紧暗角聚焦中心
    fx.uSpeed.value = this.viewMode === 'surface'
      ? ((1 - this.timeScale) / (1 - GATE_SLOW_FLOOR)) * 0.6
      : normalizedSpeed;
    fx.uTime.value = elapsed;
    fx.uGlitch.value = this.reducedMotion || this.glitchT >= 0.45 ? 0 : (1 - this.glitchT / 0.45) ** 1.5;
    fx.uFlash.value = this.flash;
    (fx.uFlashColor.value as THREE.Color).copy(this.flashColor);

    this.composer.render();
  };

  /** 推进点亮演出计时，返回本帧的秒数；未播放时为 -1。 */
  private advanceClimax(dt: number) {
    if (this.climaxT < 0) return -1;
    this.climaxT += dt;
    const t = this.climaxT;
    if (t >= CLIMAX_SECONDS) this.climaxT = -1;
    return Math.min(t, CLIMAX_SECONDS);
  }

  /** 让探索中的星球把区域群（偏向聚焦区域）平滑转向镜头，局部 +Y 对齐屏幕上方。 */
  private faceSurfaceToCamera(node: PlanetNode, dt: number) {
    if (!this.surface) return;
    node.group.getWorldPosition(this.scratchPos);
    this.faceDir.copy(this.camera.position).sub(this.scratchPos).normalize();
    this.faceUp.copy(this.camera.up).addScaledVector(this.faceDir, -this.faceDir.dot(this.camera.up)).normalize();
    this.faceRight.crossVectors(this.faceUp, this.faceDir);
    this.basisWorld.makeBasis(this.faceRight, this.faceUp, this.faceDir);

    const local = this.surface.focusDirection(this.zoneFocus, this.scratchLook);
    this.localUp.set(0, 1, 0).addScaledVector(local, -local.y).normalize();
    this.localRight.crossVectors(this.localUp, local);
    this.basisLocal.makeBasis(this.localRight, this.localUp, local).transpose();

    this.faceQuat.setFromRotationMatrix(this.basisWorld.multiply(this.basisLocal));
    this.galaxyRoot.getWorldQuaternion(this.parentQuat).invert();
    this.faceQuat.premultiply(this.parentQuat);
    node.group.quaternion.slerp(this.faceQuat, 1 - Math.exp(-dt * (this.reducedMotion ? 30 : 2.6)));
  }

  private updatePlanets(dt: number, elapsed: number) {
    const visible = this.galaxyBlend > 0.04 && !this.surfaceShown;
    this.galaxyRoot.visible = visible;
    this.portalGroup.visible = this.exploreBlend < 0.5;
    this.portalGroup.rotation.y -= dt * 0.35;
    const pulse = 1 + Math.sin(elapsed * 2.2) * 0.04;
    this.portalGroup.scale.setScalar(pulse);

    const exploredId = this.exploreBlend > 0.01 && this.surface?.docId === this.exploreDocId ? this.exploreDocId : null;
    const bump = (node: PlanetNode) => {
      const explored = node.id === exploredId;
      if (explored) {
        this.faceSurfaceToCamera(node, dt);
      } else {
        node.group.rotateY(node.spin * dt);
      }
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
        // 地表探索时其余星球退场，避免挡在探索镜头前
        const recede = this.exploreBlend > 0.001 && node.id !== this.activeId ? 1 - this.exploreBlend : 1;
        node.group.scale.setScalar(Math.max(0.001, node.restScale * recede));
        if (node !== this.coreNode) node.group.visible = recede > 0.02;
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
      this.updatePlanetStage(node, dt, elapsed);
      // 探索镜头从星系外侧看过来，补光跟着镜头，避免看到的是背光面
      const light = surfaceMat.uniforms.uLightDir.value as THREE.Vector3;
      if (explored) {
        node.group.getWorldPosition(this.scratchPos);
        this.exploreLight.copy(this.camera.position).sub(this.scratchPos).normalize();
        this.exploreLight.y += 0.45;
        this.exploreLight.addScaledVector(this.faceRight, -0.35).normalize();
        light.copy(BASE_LIGHT).lerp(this.exploreLight, this.exploreBlend).normalize();
      } else if (!light.equals(BASE_LIGHT)) {
        light.lerp(BASE_LIGHT, 1 - Math.exp(-dt * 3)).normalize();
      }
    };

    this.planets.forEach(bump);
    if (this.coreNode) bump(this.coreNode);

    if (this.surface) {
      this.attachSurface();
      this.surface.root.visible =
        this.viewMode === 'orbit' && this.activeId === this.surface.docId && this.orbitBlend > 0.3;
      this.surface.update(dt, elapsed);
    }
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
        planetName: node.planetName,
        progress: node.progress,
        index: node.index,
        x: (this.ndc.x * 0.5 + 0.5) * width,
        y: (-this.ndc.y * 0.5 + 0.5) * height,
        visible: visible && this.galaxyBlend > 0.2 && this.orbitBlend < 0.72 && this.viewMode !== 'surface',
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
    window.removeEventListener('keydown', this.onKeyDown);

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