import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import type { CosmosScene, GateCrossEvent, GateSide, SurfaceGateSpec } from '../../cosmos/CosmosScene2';
import { SurfaceFinale } from './SurfaceFinale';
import { HoloCompanion, type CompanionReaction } from './HoloCompanion';
import { codexFor, gatesFor, syncRate, type CodexRow, type KnowledgeZone, type TwinGate, type ZoneSave } from './zones';

const CALIBRATION_MS = 3000;
const BANNER_MS = 2000;
const FINALE_DELAY_MS = 600;
const FINALE_MS = 3600;
const SWIPE_PX = 36;
const LABEL_RANGE = 135;
/** 章节之间的缓冲：知识星碑展示期间不铺下一章的光门。 */
const ZONE_BUFFER_MS = 2500;
const CODEX_MS = 4200;
/** 还在后台生成的区域按这么多道门估算复苏度增量。 */
const PENDING_GATE_ESTIMATE = 3;
const CHEERS = ['SYNC UP! ✨', '完美切入！', '漂亮！', '认知同步 +1'];

interface Codex {
  key: number;
  zoneIndex: number;
  title: string;
  rows: CodexRow[];
  note?: string;
}

const waitBanner = (title: string) => `前方「${title}」仍在后台扫描 · 保持航线`;

function estimateTotal(zones: KnowledgeZone[], sets: TwinGate[][]) {
  return zones.reduce((acc, z, i) => acc + (sets[i]?.length || (z.pending ? PENDING_GATE_ESTIMATE : 0)), 0);
}

interface QueuedGate {
  gateId: string;
  zoneIndex: number;
  gateIndex: number;
  attempt: number;
  correct: GateSide;
  gate: TwinGate;
}

interface Calibration {
  key: number;
  guardian: string;
  probe: string;
  missed: boolean;
}

type Stage = 'flight' | 'finale' | 'settle';

function pickSide(text: string): GateSide {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2 === 0 ? 'left' : 'right';
}

const pad = (n: number) => String(n).padStart(2, '0');

interface Props {
  scene: CosmosScene;
  documentId: string;
  planetName: string;
  save: ZoneSave;
  update: (fn: (prev: ZoneSave) => ZoneSave) => void;
  reduced: boolean;
  onExit: () => void;
}

/** 地表穿门：极简全屏驾驶 HUD。答对推进区域，答错弹守门人认知校准并在本区末尾重排一次。 */
export const SurfaceRun = ({ scene, documentId, planetName, save, update, reduced, onExit }: Props) => {
  const zones = save.zones;
  const gateSets = useMemo(() => zones.map((z) => gatesFor(documentId, z)), [documentId, zones]);
  const gateSetsRef = useRef(gateSets);
  gateSetsRef.current = gateSets;
  const saveRef = useRef(save);
  saveRef.current = save;

  const [stage, setStage] = useState<Stage>(() =>
    save.zones.every((z) => z.status === 'completed') ? 'settle' : 'flight',
  );
  const [queue, setQueue] = useState<QueuedGate[]>([]);
  const queueRef = useRef<QueuedGate[]>([]);
  const [calib, setCalib] = useState<Calibration | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [syncFlash, setSyncFlash] = useState(false);
  const [combo, setCombo] = useState(0);
  const comboRef = useRef(0);
  const [codex, setCodex] = useState<Codex | null>(null);
  const [reaction, setReaction] = useState<CompanionReaction | null>(null);
  const cheerCount = useRef(0);
  /** 下一章还在后台生成时记下它的序号，数据到了再铺门。 */
  const waitingRef = useRef<number | null>(null);
  const labelRefs = useRef(new Map<string, HTMLDivElement>());
  const timers = useRef<number[]>([]);

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const totalGates = estimateTotal(zones, gateSets);
  const gain = totalGates ? 1 / totalGates : 0;

  const makeItem = useCallback(
    (s: ZoneSave, zoneIndex: number, gateIndex: number, attempt: number): QueuedGate => {
      const zone = s.zones[zoneIndex];
      return {
        gateId: `${zone.id}:${gateIndex}:${attempt}`,
        zoneIndex,
        gateIndex,
        attempt,
        correct: pickSide(`${documentId}|${zone.id}|${gateIndex}|${attempt}`),
        gate: gateSetsRef.current[zoneIndex][gateIndex],
      };
    },
    [documentId],
  );

  const queueZone = useCallback(
    (s: ZoneSave, zoneIndex: number): QueuedGate[] => {
      const zone = s.zones[zoneIndex];
      const set = gateSetsRef.current[zoneIndex] ?? [];
      const done = zone.status === 'completed' ? set.map((_, k) => k) : s.gates?.[zone.id]?.done ?? [];
      return set.map((_, k) => k).filter((k) => !done.includes(k)).map((k) => makeItem(s, zoneIndex, k, 0));
    },
    [makeItem],
  );

  const specOf = useCallback(
    (item: QueuedGate): SurfaceGateSpec => ({ id: item.gateId, correct: item.correct, gain }),
    [gain],
  );

  const setQueueBoth = useCallback((next: QueuedGate[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  /** 铺下一章的波次；那一章还在后台生成时先挂起，数据就绪后由下面的 effect 接上。 */
  const scheduleZone = useCallback(
    (s: ZoneSave, zoneIndex: number, delay: number) => {
      const zone = s.zones[zoneIndex];
      if (zone.pending) {
        waitingRef.current = zoneIndex;
        later(delay, () => {
          if (waitingRef.current === zoneIndex) setBanner(waitBanner(zone.title));
        });
        return;
      }
      const items = queueZone(s, zoneIndex);
      setQueueBoth([...queueRef.current, ...items]);
      later(delay, () => scene.appendSurfaceGates(items.map(specOf)));
    },
    [scene, queueZone, specOf, later, setQueueBoth],
  );

  const startFinale = useCallback(() => {
    setStage('finale');
    // 等本道光门的复苏脉冲先放出去，再接整颗星球的绽放
    later(FINALE_DELAY_MS, () => scene.playSurfaceFinale());
    later(reduced ? FINALE_DELAY_MS + 200 : FINALE_MS, () => setStage('settle'));
  }, [scene, later, reduced]);

  // 起飞：从第一个未复苏区域开始；已全部复苏则直接进入纯享漫游 + 结算舱
  useEffect(() => {
    const s = saveRef.current;
    if (s.zones.every((z) => z.status === 'completed')) {
      scene.enterSurface(documentId, { tour: true });
      return () => scene.exitSurface();
    }
    const zoneIndex = s.zones.findIndex((z) => z.status !== 'completed');
    const zone = s.zones[zoneIndex];
    const items = zone.pending ? [] : queueZone(s, zoneIndex);
    const sets = gateSetsRef.current;
    const total = estimateTotal(s.zones, sets);
    const cleared = s.zones.reduce(
      (acc, z, i) => acc + (z.status === 'completed' ? sets[i].length : s.gates?.[z.id]?.done.length ?? 0),
      0,
    );
    if (zone.pending) {
      waitingRef.current = zoneIndex;
      setBanner(waitBanner(zone.title));
    }
    queueRef.current = items;
    setQueue(items);
    scene.enterSurface(documentId, {
      gates: items.map((item) => ({ id: item.gateId, correct: item.correct, gain: total ? 1 / total : 0 })),
      terraform: total ? Math.min(1, cleared / total) : 0,
    });
    return () => scene.exitSurface();
  }, [scene, documentId, queueZone]);

  // 后台补齐的区域到了（或补齐失败被移除）：接上挂起的波次
  useEffect(() => {
    const idx = waitingRef.current;
    if (idx == null) return;
    const s = saveRef.current;
    if (s.zones[idx]?.pending) return;
    waitingRef.current = null;
    setBanner(null);
    const next = s.zones.findIndex((z) => z.status !== 'completed');
    if (next < 0) startFinale();
    else scheduleZone(s, next, 0);
  }, [zones, scheduleZone, startFinale]);

  const onCross = useCallback(
    (event: GateCrossEvent) => {
      const item = queueRef.current.find((q) => q.gateId === event.gateId);
      if (!item) return;
      let rest = queueRef.current.filter((q) => q !== item);
      const zone = saveRef.current.zones[item.zoneIndex];

      if (!event.correct) {
        comboRef.current = 0;
        setCombo(0);
        scene.setGateCombo(0);
        setReaction({ kind: 'wobble', key: performance.now() });
        const retry = makeItem(saveRef.current, item.zoneIndex, item.gateIndex, item.attempt + 1);
        rest = [...rest, retry];
        scene.appendSurfaceGates([specOf(retry)]);
        setCalib({
          key: performance.now(),
          guardian: zone.feynmanBoss.guardianName,
          probe: item.gate.probe || zone.feynmanBoss.followUpHint,
          missed: event.side === null,
        });
        setQueueBoth(rest);
        return;
      }

      // 引擎在这个回调返回后才判定光门，先同步连击数，复苏波纹和风铃音高才会跟着升级
      const nextCombo = comboRef.current + 1;
      comboRef.current = nextCombo;
      setCombo(nextCombo);
      scene.setGateCombo(nextCombo);
      cheerCount.current += 1;
      setReaction({
        kind: 'cheer',
        key: performance.now(),
        bubble: nextCombo >= 3 ? `COMBO x${nextCombo}！` : CHEERS[cheerCount.current % CHEERS.length],
      });

      const result: { save: ZoneSave | null; zoneDone: boolean } = { save: null, zoneDone: false };
      update((prev) => {
        const z = prev.zones[item.zoneIndex];
        const total = gateSetsRef.current[item.zoneIndex].length;
        const done = [...new Set([...(prev.gates?.[z.id]?.done ?? []), item.gateIndex])];
        const zoneDone = done.length >= total;
        result.zoneDone = zoneDone;
        const zonesNext = zoneDone
          ? prev.zones.map((zz, k) => {
              if (k === item.zoneIndex) return { ...zz, status: 'completed' as const };
              if (k === item.zoneIndex + 1 && zz.status === 'locked') return { ...zz, status: 'active' as const };
              return zz;
            })
          : prev.zones;
        const next: ZoneSave = { ...prev, zones: zonesNext, gates: { ...(prev.gates ?? {}), [z.id]: { done, total } } };
        result.save = next;
        return next;
      });
      setSyncFlash(true);
      later(1200, () => setSyncFlash(false));

      setQueueBoth(rest);
      const latest = result.save;
      if (result.zoneDone && latest) {
        const key = performance.now();
        setCodex({
          key,
          zoneIndex: item.zoneIndex,
          title: zone.title,
          rows: codexFor(documentId, zone),
          note: zone.monolithNote,
        });
        later(CODEX_MS, () => setCodex((c) => (c?.key === key ? null : c)));
        const nextIndex = latest.zones.findIndex((z, k) => k > item.zoneIndex && z.status !== 'completed');
        if (nextIndex >= 0) {
          setBanner(`ZONE ${pad(item.zoneIndex + 1)} · ${zone.title} 已复苏 —— 驶向 ${latest.zones[nextIndex].title}`);
          later(BANNER_MS, () => setBanner((b) => (b?.startsWith('ZONE') ? null : b)));
          scheduleZone(latest, nextIndex, ZONE_BUFFER_MS);
        } else if (latest.zones.every((z) => z.status === 'completed')) {
          startFinale();
        }
      }
    },
    [scene, documentId, update, makeItem, specOf, later, setQueueBoth, scheduleZone, startFinale],
  );

  useEffect(() => {
    scene.setCallbacks({
      onGateCross: onCross,
      onGateAnchors: (list) => {
        const seen = new Set<string>();
        list.forEach((a) => {
          const key = `${a.gateId}:${a.side}`;
          const el = labelRefs.current.get(key);
          if (!el) return;
          seen.add(key);
          // 题目文字固定在屏幕左右两侧，不跟随光门投影移动，只按光门状态淡入淡出
          const show = a.state === 'pending' && a.distance > -2 && a.distance < LABEL_RANGE;
          el.style.opacity = show ? a.fade.toFixed(2) : '0';
          el.classList.toggle('focus', a.focus && a.distance < 45);
        });
        labelRefs.current.forEach((el, key) => {
          if (!seen.has(key)) el.style.opacity = '0';
        });
      },
    });
    return () => scene.setCallbacks({ onGateCross: undefined, onGateAnchors: undefined });
  }, [scene, onCross]);

  // 守门人认知校准：停留 3.0s，空格跳过
  useEffect(() => {
    if (!calib) return;
    const timer = window.setTimeout(() => setCalib(null), CALIBRATION_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        setCalib(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [calib]);

  // 鼠标/触屏：水平拖拽换轨，单击屏幕左右两侧换轨，触控板横向滚动换轨
  useEffect(() => {
    let active = false;
    let swiped = false;
    let startX = 0;
    let wheelAt = 0;
    const isUi = (target: EventTarget | null) =>
      target instanceof HTMLElement && Boolean(target.closest('button, a, textarea, input, .surface-panel, .surface-calib, .surface-hud'));
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || isUi(e.target)) return;
      active = true;
      swiped = false;
      startX = e.clientX;
    };
    const move = (e: PointerEvent) => {
      if (!active) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) < SWIPE_PX) return;
      scene.steerSurface(dx < 0 ? 'left' : 'right');
      startX = e.clientX;
      swiped = true;
    };
    const up = (e: PointerEvent) => {
      if (!active) return;
      active = false;
      if (swiped) return;
      const x = e.clientX / window.innerWidth;
      if (x < 0.4) scene.steerSurface('left');
      else if (x > 0.6) scene.steerSurface('right');
    };
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) < 12 || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
      const now = performance.now();
      if (now - wheelAt < 280) return;
      wheelAt = now;
      scene.steerSurface(e.deltaX < 0 ? 'left' : 'right');
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('wheel', wheel, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('wheel', wheel);
    };
  }, [scene]);

  const rate = syncRate(zones, save);
  const current = zones.findIndex((z) => z.status !== 'completed');
  const currentZone: KnowledgeZone | undefined = zones[current];

  return (
    <div className={`surface-run stage-${stage}`}>
      <header className="surface-hud">
        <span className="surface-planet">{planetName}</span>
        <div className="surface-progress">
          <ol className="surface-zones" aria-label="区域进度">
            {zones.map((z, i) => {
              const total = gateSets[i].length || 1;
              const pct = z.status === 'completed' ? 100 : ((save.gates?.[z.id]?.done.length ?? 0) / total) * 100;
              return (
                <li key={z.id} className={`${z.status}${i === current ? ' current' : ''}`}>
                  <i style={{ width: `${pct}%` }} />
                </li>
              );
            })}
          </ol>
          <span className="surface-zone-name">
            {currentZone ? `ZONE ${pad(current + 1)} · ${currentZone.title}` : '全部区域已复苏'}
          </span>
        </div>
        {combo > 0 ? (
          <span className={`surface-combo${combo >= 3 ? ' hot' : ''}`} key={combo} aria-label={`连击 ${combo}`}>
            x{combo}
          </span>
        ) : null}
        <span className={`surface-sync${syncFlash ? ' flash' : ''}`}>
          同步率 <b>{rate}%</b>
        </span>
        <button type="button" className="surface-exit" onClick={onExit} aria-label="返回轨道">
          <LogOut size={14} />
        </button>
      </header>

      <div className="gate-labels" aria-hidden="true">
        {queue.map((item) =>
          (['left', 'right'] as const).map((side) => (
            <div
              key={`${item.gateId}:${side}`}
              ref={(el) => {
                const key = `${item.gateId}:${side}`;
                if (el) labelRefs.current.set(key, el);
                else labelRefs.current.delete(key);
              }}
              className={`gate-label ${side}`}
            >
              <span className="gate-key">{side === 'left' ? 'A ←' : '→ D'}</span>
              {side === item.correct ? item.gate.truth : item.gate.trap}
            </div>
          )),
        )}
      </div>

      {banner ? (
        <p className="surface-banner" key={banner}>
          {banner}
        </p>
      ) : null}

      {calib ? (
        <div className="surface-calib" key={calib.key} role="status" onClick={() => setCalib(null)}>
          <span className="surface-calib-tag">
            {calib.guardian} · 认知校准{calib.missed ? ' · 你没有切入任何一道光门' : ''}
          </span>
          <p>{calib.probe}</p>
          <span className="surface-calib-skip">本题已排到本区末尾 · 空格跳过</span>
          {reduced ? null : <i className="surface-calib-timer" />}
        </div>
      ) : null}

      {codex ? (
        <aside className="zone-codex" key={codex.key} aria-live="polite">
          <p className="zone-codex-kicker">章节知识星碑 · ZONE {pad(codex.zoneIndex + 1)}</p>
          <h3>{codex.title}</h3>
          <ol>
            {codex.rows.map((row) => (
              <li key={row.label + row.truth}>
                <span>{row.label}</span>
                <b>{row.truth}</b>
                {row.note ? <em>{row.note}</em> : null}
              </li>
            ))}
          </ol>
          {codex.note ? <p className="zone-codex-note">{codex.note}</p> : null}
        </aside>
      ) : null}

      <HoloCompanion progress={rate} reaction={reaction} reduced={reduced} className="in-flight" />

      {stage === 'finale' ? <p className="surface-banner finale">同步率 100% · 整颗星球正在绽放</p> : null}

      {stage === 'settle' ? (
        <SurfaceFinale
          scene={scene}
          documentId={documentId}
          planetName={planetName}
          zones={zones}
          gateSets={gateSets}
          reduced={reduced}
        />
      ) : null}

      <p className="surface-hint">[ A / D 或 ← / → 左右换轨 ]{stage === 'flight' ? ' · 拖动或点击屏幕两侧也可换轨' : ''}</p>
    </div>
  );
};
