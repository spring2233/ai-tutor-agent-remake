import { useEffect, useRef, type RefObject } from 'react';

interface Point {
  x: number;
  y: number;
}

interface Props {
  /** 每帧读取星球信标的屏幕投影；不可见时返回 null。 */
  getSource: () => (Point & { visible: boolean }) | null;
  target: RefObject<HTMLElement | null>;
  resonance: number;
  /** 最近一次键入的时间戳（performance.now）。 */
  typingAt: RefObject<number>;
  charging: boolean;
  tense: boolean;
  reduced: boolean;
}

const SAMPLES = 56;
const SPARKS = 6;
const DIM = [61, 95, 154];
const AMBER = [244, 184, 96];
const CREAM = [255, 246, 224];

function mixColor(a: number[], b: number[], t: number) {
  const k = Math.min(1, Math.max(0, t));
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;
}

function bezier(p0: Point, p1: Point, p2: Point, p3: Point, s: number): Point {
  const u = 1 - s;
  const a = u * u * u;
  const b = 3 * u * u * s;
  const c = 3 * u * s * s;
  const d = s * s * s;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/** 跨维共鸣丝线：星球信标投影点 ↔ 右侧对线输入框。替代进度条。 */
export const ResonanceTether = ({ getSource, target, resonance, typingAt, charging, tense, reduced }: Props) => {
  const glowRef = useRef<SVGPathElement>(null);
  const coreRef = useRef<SVGPathElement>(null);
  const nodeRef = useRef<SVGCircleElement>(null);
  const sparkRefs = useRef<(SVGCircleElement | null)[]>([]);
  const live = useRef({ resonance, charging, tense, reduced, getSource });
  live.current = { resonance, charging, tense, reduced, getSource };

  useEffect(() => {
    let raf = 0;
    const pts: Point[] = Array.from({ length: SAMPLES + 1 }, () => ({ x: 0, y: 0 }));
    let shownResonance = live.current.resonance;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const { resonance: r, charging: busy, tense: taut, reduced: still, getSource: source } = live.current;
      const glow = glowRef.current;
      const core = coreRef.current;
      const from = source();
      const el = target.current;
      if (!glow || !core || !from || !from.visible || !el) {
        glow?.setAttribute('opacity', '0');
        core?.setAttribute('opacity', '0');
        nodeRef.current?.setAttribute('opacity', '0');
        sparkRefs.current.forEach((s) => s?.setAttribute('opacity', '0'));
        return;
      }
      shownResonance += (r - shownResonance) * 0.06;
      const level = shownResonance / 100;
      const rect = el.getBoundingClientRect();
      const panel = el.closest('.zone-capsule')?.getBoundingClientRect();
      // 任务舱在星球下方（窄屏抽屉）时，丝线接到舱体上沿，否则会被舱体盖住
      const stacked = panel && from.x > rect.left;
      const to = stacked && panel
        ? { x: panel.left + panel.width * 0.22, y: panel.top - 2 }
        : { x: rect.left - 6, y: rect.top + rect.height / 2 };
      const dx = to.x - from.x;
      const p1 = { x: from.x + dx * 0.32, y: from.y - 70 };
      const p2 = { x: from.x + dx * 0.7, y: to.y + 60 };
      const t = now / 1000;
      const typing = !still && now - (typingAt.current ?? 0) < 380 ? 1 : 0;

      const slow = still || taut ? 0 : 7 + level * 9 + (busy ? 6 : 0);
      const fast = still || taut ? 0 : typing * 3.2 + (busy ? 1.6 : 0);
      for (let i = 0; i <= SAMPLES; i += 1) {
        const s = i / SAMPLES;
        const p = bezier(from, p1, p2, to, s);
        const ahead = bezier(from, p1, p2, to, Math.min(1, s + 0.01));
        const behind = bezier(from, p1, p2, to, Math.max(0, s - 0.01));
        let nx = -(ahead.y - behind.y);
        let ny = ahead.x - behind.x;
        const len = Math.hypot(nx, ny) || 1;
        nx /= len;
        ny /= len;
        const env = Math.sin(Math.PI * s);
        const wave = slow * Math.sin(s * 6.5 + t * (1.4 + level * 2.2)) + fast * Math.sin(s * 46 + t * 42);
        pts[i].x = p.x + nx * wave * env;
        pts[i].y = p.y + ny * wave * env;
      }
      const d = `M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')}`;

      const color = taut ? `rgb(${CREAM.join(',')})` : level < 0.6 ? mixColor(DIM, AMBER, level / 0.6) : mixColor(AMBER, CREAM, (level - 0.6) / 0.4);
      const width = taut ? 4.6 : 1 + level * 3 + typing * 0.4;
      const opacity = taut ? 1 : 0.42 + level * 0.5 + typing * 0.08;
      core.setAttribute('d', d);
      core.setAttribute('stroke', color);
      core.setAttribute('stroke-width', width.toFixed(2));
      core.setAttribute('opacity', opacity.toFixed(2));
      core.setAttribute('stroke-dasharray', level < 0.02 && !taut ? '5 7' : 'none');
      glow.setAttribute('d', d);
      glow.setAttribute('stroke', color);
      glow.setAttribute('stroke-width', (width * (taut ? 5 : 3.2)).toFixed(2));
      glow.setAttribute('opacity', (taut ? 0.85 : 0.12 + level * 0.4).toFixed(2));

      const node = nodeRef.current;
      if (node) {
        node.setAttribute('cx', from.x.toFixed(1));
        node.setAttribute('cy', from.y.toFixed(1));
        node.setAttribute('r', (4 + level * 4 + (taut ? 6 : 0) + Math.sin(t * 4) * 1.2).toFixed(1));
        node.setAttribute('fill', color);
        node.setAttribute('opacity', opacity.toFixed(2));
      }

      // 光点从输入框沿丝线飞向星球：共鸣 ≥60% 或评估中出现
      const flowing = taut || level >= 0.6 || busy;
      sparkRefs.current.forEach((spark, k) => {
        if (!spark) return;
        if (!flowing || still) {
          spark.setAttribute('opacity', '0');
          return;
        }
        const speed = taut ? 1.6 : 0.35 + level * 0.5;
        const s = 1 - ((t * speed + k / SPARKS) % 1);
        const p = pts[Math.round(s * SAMPLES)];
        spark.setAttribute('cx', p.x.toFixed(1));
        spark.setAttribute('cy', p.y.toFixed(1));
        spark.setAttribute('r', (taut ? 3.4 : 2.2).toFixed(1));
        spark.setAttribute('fill', taut ? '#fff6e0' : '#ffe0a8');
        spark.setAttribute('opacity', (Math.sin(Math.PI * s) * (taut ? 1 : 0.85)).toFixed(2));
      });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target, typingAt]);

  return (
    <svg className="resonance-tether" aria-hidden="true">
      <defs>
        <filter id="tether-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <path ref={glowRef} fill="none" strokeLinecap="round" filter="url(#tether-blur)" opacity="0" />
      <path ref={coreRef} fill="none" strokeLinecap="round" opacity="0" />
      <circle ref={nodeRef} opacity="0" />
      {Array.from({ length: SPARKS }, (_, k) => (
        <circle
          key={k}
          ref={(el) => {
            sparkRefs.current[k] = el;
          }}
          opacity="0"
        />
      ))}
    </svg>
  );
};
