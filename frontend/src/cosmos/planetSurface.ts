import * as THREE from 'three';

export type ZoneStatus = 'locked' | 'active' | 'completed';

export interface SurfaceZone {
  id: string;
  title: string;
  status: ZoneStatus;
}

export interface ZoneAnchor {
  id: string;
  title: string;
  index: number;
  x: number;
  y: number;
  visible: boolean;
  status: ZoneStatus;
}

// 星球球体半径（与 CosmosScene2 的 planetSphereGeo 一致，局部坐标）
const R = 1.6;
const SINK = -0.18;
const FOG_COUNT = 420;
export const UNLOCK_SECONDS = 2.0;
export const COMPLETE_IGNITE = 0.45;
const PULSE_SECONDS = 1.05;

const CREAM = new THREE.Color(0xf5efe2);
const CYAN = new THREE.Color(0x7ee0d6);
const GOLD = new THREE.Color(0xf4c98b);
const DIM = new THREE.Color(0x2a2440);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function backOut(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

function smooth(t: number) {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
}

const fogVertex = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uCollapse;
  uniform float uPixelRatio;
  varying float vAlpha;
  varying float vSeed;
  varying float vCollapse;

  void main() {
    vec3 p = position;
    float c = uCollapse;
    float swirl = c * c * 10.0 + uTime * (0.25 + aSeed * 0.35);
    float cs = cos(swirl);
    float sn = sin(swirl);
    p.xz = mat2(cs, -sn, sn, cs) * p.xz;
    float shrink = 1.0 - smoothstep(0.0, 1.0, c);
    p.xz *= shrink;
    p.y = mix(p.y, 0.1, smoothstep(0.0, 1.0, c));
    p.y += sin(uTime * 0.8 + aSeed * 12.0) * 0.02 * (1.0 - c);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (9.0 + aSeed * 15.0) * uPixelRatio * (6.0 / max(-mv.z, 0.5)) * (1.0 - c * 0.45);
    vAlpha = 1.0 - smoothstep(0.55, 1.0, c);
    vSeed = aSeed;
    vCollapse = c;
  }
`;

const fogFragment = /* glsl */ `
  varying float vAlpha;
  varying float vSeed;
  varying float vCollapse;

  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float soft = pow(1.0 - r, 1.6);
    vec3 deep = vec3(0.09, 0.04, 0.18);
    vec3 haze = vec3(0.38, 0.27, 0.66);
    vec3 col = mix(deep, haze, vSeed * 0.55);
    col = mix(col, vec3(0.78, 0.7, 1.0), vCollapse * 0.6);
    gl_FragColor = vec4(col, soft * vAlpha * 0.6);
  }
`;

const arcVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const arcFragment = /* glsl */ `
  uniform float uGrow;
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    if (vUv.x > uGrow) discard;
    float flow = 0.55 + 0.45 * sin(vUv.x * 42.0 - uTime * 4.0);
    float head = smoothstep(uGrow - 0.1, uGrow, vUv.x) * step(uGrow, 0.999);
    vec3 col = uColor * (0.65 + flow * 0.5) + vec3(1.0, 0.96, 0.88) * head * 1.2;
    gl_FragColor = vec4(col, 0.55 + flow * 0.35 + head * 0.4);
  }
`;

interface Beacon {
  id: string;
  title: string;
  status: ZoneStatus;
  dir: THREE.Vector3;
  site: THREE.Group;
  head: THREE.Group;
  core: THREE.Mesh;
  coreMat: THREE.MeshBasicMaterial;
  beamMat: THREE.MeshBasicMaterial;
  beam: THREE.Mesh;
  lockRing: THREE.Group;
  lockMat: THREE.MeshBasicMaterial;
  capMat: THREE.MeshBasicMaterial;
  fog: THREE.Points;
  fogMat: THREE.ShaderMaterial;
  pulse: THREE.Mesh;
  pulseMat: THREE.MeshBasicMaterial;
  hit: THREE.Mesh;
  lift: number;
  collapse: number;
  activeAmt: number;
  doneAmt: number;
  unlockT: number;
  completeT: number;
}

interface Arc {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  grow: number;
}

function zoneDirection(index: number, total: number) {
  const t = total <= 1 ? 0.5 : index / (total - 1);
  const phi = (t - 0.5) * 1.85;
  const elev = 0.36 * Math.sin(t * Math.PI * 1.5 + 0.4) - 0.1;
  return new THREE.Vector3(Math.sin(phi) * Math.cos(elev), Math.sin(elev), Math.cos(phi) * Math.cos(elev)).normalize();
}

function buildFogGeometry() {
  const positions = new Float32Array(FOG_COUNT * 3);
  const seeds = new Float32Array(FOG_COUNT);
  for (let i = 0; i < FOG_COUNT; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.6) * 0.46;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = -0.02 + Math.random() * 0.34 * (1 - r * 1.2);
    positions[i * 3 + 2] = Math.sin(a) * r;
    seeds[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  return geo;
}

function buildArcGeometry(a: THREE.Vector3, b: THREE.Vector3) {
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 32; k += 1) {
    const s = k / 32;
    const d = new THREE.Vector3().lerpVectors(a, b, s).normalize();
    pts.push(d.multiplyScalar(R * (1.012 + Math.sin(Math.PI * s) * 0.05)));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.012, 6, false);
}

/** 星球地表知识区域：信标、迷雾团、能量弧线与脉冲环。挂在某颗星球 group 下随其缩放旋转。 */
export class PlanetSurface {
  readonly docId: string;
  readonly root = new THREE.Group();
  private beacons: Beacon[] = [];
  private arcs: (Arc | null)[] = [];
  private center = new THREE.Vector3(0, 0, 1);
  private shared: THREE.BufferGeometry[] = [];
  private scratch = new THREE.Vector3();
  private scratch2 = new THREE.Vector3();
  private pixelRatio: number;

  constructor(docId: string, zones: SurfaceZone[], pixelRatio: number) {
    this.docId = docId;
    this.pixelRatio = pixelRatio;
    this.root.name = 'planet-surface';
    this.build(zones);
  }

  get ids() {
    return this.beacons.map((b) => b.id);
  }

  private build(zones: SurfaceZone[]) {
    const coreGeo = new THREE.OctahedronGeometry(0.075, 0);
    const beamGeo = new THREE.CylinderGeometry(0.01, 0.03, 0.55, 8, 1, true);
    const hexGeo = new THREE.RingGeometry(0.16, 0.18, 6);
    const arcGeo = new THREE.RingGeometry(0.235, 0.25, 32, 1, 0, Math.PI * 0.42);
    const capGeo = new THREE.SphereGeometry(R * 1.006, 28, 6, 0, Math.PI * 2, 0, 0.3);
    const pulseGeo = new THREE.RingGeometry(0.2, 0.26, 72);
    const hitGeo = new THREE.SphereGeometry(0.24, 10, 8);
    this.shared.push(coreGeo, beamGeo, hexGeo, arcGeo, capGeo, pulseGeo, hitGeo);

    const center = new THREE.Vector3();
    zones.forEach((zone, index) => {
      const dir = zoneDirection(index, zones.length);
      center.add(dir);
      const orient = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);

      const site = new THREE.Group();
      site.position.copy(dir).multiplyScalar(R);
      site.quaternion.copy(orient);

      const capPivot = new THREE.Group();
      capPivot.quaternion.copy(orient);
      const capMat = new THREE.MeshBasicMaterial({
        color: CYAN,
        wireframe: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      capPivot.add(new THREE.Mesh(capGeo, capMat));

      const head = new THREE.Group();
      const coreMat = new THREE.MeshBasicMaterial({ color: DIM.clone(), toneMapped: false });
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.position.y = 0.12;
      const beamMat = new THREE.MeshBasicMaterial({
        color: CYAN.clone(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = 0.4;

      const lockMat = new THREE.MeshBasicMaterial({
        color: CYAN.clone(),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const lockRing = new THREE.Group();
      const hex = new THREE.Mesh(hexGeo, lockMat);
      hex.rotation.x = -Math.PI / 2;
      lockRing.add(hex);
      for (let k = 0; k < 3; k += 1) {
        const seg = new THREE.Mesh(arcGeo, lockMat);
        seg.rotation.x = -Math.PI / 2;
        seg.rotation.z = (k / 3) * Math.PI * 2;
        lockRing.add(seg);
      }
      lockRing.position.y = 0.05;
      lockRing.scale.setScalar(0.001);

      const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
      hit.position.y = 0.12;
      hit.userData = { kind: 'zone', zoneIndex: index, docId: this.docId };

      head.add(core, beam, lockRing, hit);
      head.position.y = SINK;

      const fogMat = new THREE.ShaderMaterial({
        vertexShader: fogVertex,
        fragmentShader: fogFragment,
        uniforms: {
          uTime: { value: 0 },
          uCollapse: { value: 0 },
          uPixelRatio: { value: this.pixelRatio },
        },
        transparent: true,
        depthWrite: false,
      });
      const fogGeo = buildFogGeometry();
      this.shared.push(fogGeo);
      const fog = new THREE.Points(fogGeo, fogMat);
      fog.frustumCulled = false;

      const pulseMat = new THREE.MeshBasicMaterial({
        color: CREAM.clone(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const pulse = new THREE.Mesh(pulseGeo, pulseMat);
      pulse.rotation.x = -Math.PI / 2;
      pulse.position.y = 0.025;
      pulse.visible = false;

      site.add(head, fog, pulse);
      this.root.add(site, capPivot);

      const unlocked = zone.status !== 'locked';
      this.beacons.push({
        id: zone.id,
        title: zone.title,
        status: zone.status,
        dir,
        site,
        head,
        core,
        coreMat,
        beamMat,
        beam,
        lockRing,
        lockMat,
        capMat,
        fog,
        fogMat,
        pulse,
        pulseMat,
        hit,
        lift: unlocked ? 0 : SINK,
        collapse: unlocked ? 1 : 0,
        activeAmt: zone.status === 'active' ? 1 : 0,
        doneAmt: zone.status === 'completed' ? 1 : 0,
        unlockT: -1,
        completeT: -1,
      });

      if (index === 0) {
        this.arcs.push(null);
        return;
      }
      const prev = this.beacons[index - 1].dir;
      const mat = new THREE.ShaderMaterial({
        vertexShader: arcVertex,
        fragmentShader: arcFragment,
        uniforms: {
          uGrow: { value: unlocked ? 1 : 0 },
          uTime: { value: 0 },
          uColor: { value: CYAN.clone() },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const tube = buildArcGeometry(prev, dir);
      this.shared.push(tube);
      const mesh = new THREE.Mesh(tube, mat);
      this.root.add(mesh);
      this.arcs.push({ mesh, mat, grow: unlocked ? 1 : 0 });
    });
    if (center.lengthSq() > 0) this.center.copy(center.normalize());
  }

  /** 同步持久化状态；正在播放序列的区域不被打断。 */
  setStatuses(zones: SurfaceZone[]) {
    zones.forEach((zone, index) => {
      const b = this.beacons[index];
      if (!b) return;
      b.title = zone.title;
      if (b.status === zone.status || b.unlockT >= 0 || b.completeT >= 0) return;
      b.status = zone.status;
      const unlocked = zone.status !== 'locked';
      b.lift = unlocked ? 0 : SINK;
      b.collapse = unlocked ? 1 : 0;
      const arc = this.arcs[index];
      if (arc) arc.grow = unlocked ? 1 : 0;
    });
  }

  unlockZone(index: number, instant: boolean) {
    const b = this.beacons[index];
    if (!b || b.status !== 'locked') return;
    b.status = 'active';
    if (instant) {
      b.lift = 0;
      b.collapse = 1;
      const arc = this.arcs[index];
      if (arc) arc.grow = 1;
      return;
    }
    b.unlockT = 0;
  }

  completeZone(index: number, instant: boolean) {
    const b = this.beacons[index];
    if (!b || b.status === 'completed') return;
    if (b.status === 'locked') {
      b.lift = 0;
      b.collapse = 1;
    }
    b.status = 'completed';
    b.completeT = instant ? -1 : 0;
  }

  /** 局部坐标下应当朝向相机的方向：区域群中心，向聚焦区域偏一点。 */
  focusDirection(index: number | null, out: THREE.Vector3) {
    out.copy(this.center);
    const b = index != null ? this.beacons[index] : undefined;
    if (b) out.multiplyScalar(0.55).addScaledVector(b.dir, 0.45);
    return out.normalize();
  }

  pickTargets() {
    return this.beacons.map((b) => b.hit);
  }

  update(dt: number, time: number) {
    this.beacons.forEach((b, index) => {
      const arc = this.arcs[index];
      if (b.unlockT >= 0) {
        b.unlockT += dt;
        const t = b.unlockT;
        b.collapse = smooth(t / 1.6);
        const rise = clamp01((t - 0.55) / 1.45);
        b.lift = SINK + (0 - SINK) * backOut(rise);
        if (arc) arc.grow = smooth((t - 0.3) / 1.5);
        if (t >= UNLOCK_SECONDS) {
          b.unlockT = -1;
          b.lift = 0;
          b.collapse = 1;
          if (arc) arc.grow = 1;
        }
      }

      let ignite = -1;
      if (b.completeT >= 0) {
        b.completeT += dt;
        ignite = b.completeT - COMPLETE_IGNITE;
        if (ignite > PULSE_SECONDS) b.completeT = -1;
      }
      const visuallyDone = b.status === 'completed' && (b.completeT < 0 || ignite >= 0);
      const activeTarget = b.status === 'active' || (b.status === 'completed' && !visuallyDone) ? 1 : 0;
      b.activeAmt = THREE.MathUtils.damp(b.activeAmt, activeTarget, 5, dt);
      b.doneAmt = THREE.MathUtils.damp(b.doneAmt, visuallyDone ? 1 : 0, 6, dt);

      b.head.position.y = b.lift;
      b.fogMat.uniforms.uTime.value = time;
      b.fogMat.uniforms.uCollapse.value = b.collapse;
      b.fog.visible = b.collapse < 0.999;

      const breath = 0.5 + 0.5 * Math.sin(time * 2.6 + index * 1.3);
      const emerged = smooth((b.lift - SINK) / -SINK);
      b.coreMat.color.copy(DIM).lerp(this.scratchColor(CYAN, GOLD, breath), b.activeAmt).lerp(CREAM, b.doneAmt);
      b.core.rotation.y += dt * (0.6 + b.activeAmt * 1.4);
      b.beamMat.color.copy(CYAN).lerp(CREAM, b.doneAmt);
      b.beamMat.opacity = emerged * (b.activeAmt * (0.3 + breath * 0.45) + b.doneAmt * 0.55);
      b.beam.visible = b.beamMat.opacity > 0.01;

      b.lockRing.visible = b.activeAmt > 0.02;
      b.lockRing.scale.setScalar(Math.max(0.001, b.activeAmt * (1 + breath * 0.06)));
      b.lockRing.rotation.y += dt * 0.9;
      b.lockMat.color.copy(CYAN).lerp(GOLD, breath * 0.6);
      b.lockMat.opacity = 0.85 * b.activeAmt;

      b.capMat.color.copy(CYAN).lerp(CREAM, b.doneAmt);
      b.capMat.opacity = b.activeAmt * 0.07 + b.doneAmt * 0.3;

      if (ignite >= 0 && ignite <= PULSE_SECONDS) {
        const k = ignite / PULSE_SECONDS;
        const ease = 1 - (1 - k) ** 3;
        b.pulse.visible = true;
        b.pulse.scale.setScalar(1 + 7 * ease);
        b.pulseMat.opacity = 0.9 * (1 - k);
        b.core.scale.setScalar(1 + 1.6 * (1 - k));
      } else {
        b.pulse.visible = false;
        b.core.scale.setScalar(1);
      }

      if (arc) {
        arc.mat.uniforms.uGrow.value = arc.grow;
        arc.mat.uniforms.uTime.value = time;
        const prevDone = this.beacons[index - 1].doneAmt;
        (arc.mat.uniforms.uColor.value as THREE.Color).copy(CYAN).lerp(CREAM, Math.min(prevDone, b.doneAmt));
        arc.mesh.visible = arc.grow > 0.001;
      }
    });
  }

  private colorScratch = new THREE.Color();
  private scratchColor(a: THREE.Color, b: THREE.Color, t: number) {
    return this.colorScratch.copy(a).lerp(b, t);
  }

  anchors(camera: THREE.Camera, width: number, height: number, visible: boolean): ZoneAnchor[] {
    const planetCenter = this.root.getWorldPosition(this.scratch2);
    const centerX = planetCenter.x;
    const centerY = planetCenter.y;
    const centerZ = planetCenter.z;
    return this.beacons.map((b, index) => {
      const p = b.core.getWorldPosition(this.scratch);
      const nx = p.x - centerX;
      const ny = p.y - centerY;
      const nz = p.z - centerZ;
      const cx = camera.position.x - p.x;
      const cy = camera.position.y - p.y;
      const cz = camera.position.z - p.z;
      const facing = (nx * cx + ny * cy + nz * cz) / (Math.hypot(nx, ny, nz) * Math.hypot(cx, cy, cz) || 1);
      p.project(camera);
      return {
        id: b.id,
        title: b.title,
        index,
        x: (p.x * 0.5 + 0.5) * width,
        y: (-p.y * 0.5 + 0.5) * height,
        visible: visible && facing > 0.08 && p.z < 1,
        status: b.status,
      };
    });
  }

  dispose() {
    this.root.removeFromParent();
    this.shared.forEach((geo) => geo.dispose());
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
  }
}
