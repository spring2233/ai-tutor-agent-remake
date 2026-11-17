import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { CornerDownLeft, Loader2, Plane, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { useCosmos } from '../../cosmos/CosmosContext';
import type { ZoneAnchor } from '../../cosmos/CosmosScene2';
import { ResonanceTether } from './ResonanceTether';
import { SurfaceRun } from './SurfaceRun';
import { HoloCompanion, type CompanionReaction } from './HoloCompanion';
import { useTypewriter } from './useTypewriter';
import { OrbitModes } from '../shell/OrbitModes';
import { getPresetPlanet } from '../../cosmos/presetPlanets';
import {
  capsulesFor,
  clearZoneSave,
  dropPendingZones,
  ensureFrontier,
  fetchRestZones,
  fetchZones,
  hasPendingZones,
  intelFor,
  judgeFeynman,
  loadZoneSave,
  mergeRestZones,
  storeZoneSave,
  syncRate,
  type KnowledgeZone,
  type ZonePhase,
  type ZoneSave,
} from './zones';
import '../../pages/landing.css';
import '../../pages/galaxy.css';
import './explore.css';

const CURRENT_DOCUMENT_KEY = 'ai-tutor-current-document-v2';
const CURRENT_DOCUMENT_NAME_KEY = 'ai-tutor-current-document-name-v2';
const PHASES = ['信号降噪', '逻辑接驳', '费曼对线'];
const CLIMAX_MS = 1500;
const DEFAULT_PLACEHOLDER = '用你自己的话向守门人解释……  Enter 发送共振';
const STATUS_LABEL = { locked: '迷雾封锁', active: '待探索', completed: '已净化' } as const;

type ScreenPoint = { x: number; y: number; visible: boolean };

function useAnimatedNumber(value: number, ms: number) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - k) ** 3;
      const v = origin + (value - origin) * eased;
      from.current = v;
      setShown(Math.round(v));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

// ----------------------------------------------------------------------------
// Phase 1 / 2：信号降噪 & 逻辑回路接驳（轻量即时反馈）
// ----------------------------------------------------------------------------

interface ChoiceProps {
  kicker: string;
  prompt: string;
  options: { label: string; correct: boolean }[];
  why: string;
  reduced: boolean;
  onPass: () => void;
}

const ChoiceStep = ({ kicker, prompt, options, why, reduced, onPass }: ChoiceProps) => {
  const [wrong, setWrong] = useState<string[]>([]);
  const [charged, setCharged] = useState(false);

  const pick = (label: string, correct: boolean) => {
    if (charged) return;
    if (!correct) {
      setWrong((prev) => (prev.includes(label) ? prev : [...prev, label]));
      return;
    }
    setCharged(true);
    window.setTimeout(onPass, reduced ? 0 : 700);
  };

  return (
    <div className="zone-step">
      <p className="zone-step-kicker">{kicker}</p>
      <h3 className="zone-step-prompt">{prompt}</h3>
      <div className="zone-options">
        {options.map((option) => {
          const missed = wrong.includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              className={`zone-option${missed ? ' missed' : ''}${charged && option.correct ? ' hit' : ''}`}
              disabled={missed || charged}
              onClick={() => pick(option.label, option.correct)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {charged ? <p className="zone-energy-gain">+1 能量 · 回路已接通</p> : null}
      {wrong.length > 0 && !charged ? (
        <div className="patch-card" key={wrong.length}>
          <span className="patch-tag">知识补丁</span>
          <p>{why}</p>
        </div>
      ) : null}
    </div>
  );
};

// ----------------------------------------------------------------------------
// 战前扫描档案：没读过文档也能先建立认知底牌
// ----------------------------------------------------------------------------

const IntelBriefCard = ({ zone, onStart }: { zone: KnowledgeZone; onStart: () => void }) => {
  const intel = intelFor(zone);
  return (
    <div className="intel-brief">
      <p className="zone-step-kicker">扫描档案 · 30 秒建立认知底牌</p>
      <ol className="intel-points">
        {intel.conclusions.map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </ol>
      {intel.analogy ? (
        <p className="intel-analogy">
          <span>生活类比</span>
          {intel.analogy}
        </p>
      ) : null}
      <button type="button" className="btn btn-primary" onClick={onStart}>
        开始信号校准
      </button>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Phase 3：守门人费曼对线（打字机 + 共鸣丝线 + 单输入框）
// ----------------------------------------------------------------------------

interface DuelProps {
  zone: KnowledgeZone;
  capsules: string[];
  initialResonance: number;
  reduced: boolean;
  getSource: () => ScreenPoint | null;
  onTick: () => void;
  onResonance: (value: number) => void;
  onComplete: () => void;
}

const FeynmanDuel = ({ zone, capsules, initialResonance, reduced, getSource, onTick, onResonance, onComplete }: DuelProps) => {
  const boss = zone.feynmanBoss;
  const [line, setLine] = useState(boss.challengePrompt);
  const [clueOpen, setClueOpen] = useState(false);
  const [usedTerms, setUsedTerms] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [placeholder, setPlaceholder] = useState(DEFAULT_PLACEHOLDER);
  const [resonance, setResonance] = useState(Math.min(initialResonance, 95));
  const [busy, setBusy] = useState(false);
  const [tense, setTense] = useState(false);
  const [offline, setOffline] = useState(false);
  const typingAt = useRef(0);
  const inputWrap = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const { shown, done } = useTypewriter(line, { reduced, onTick });
  const readout = useAnimatedNumber(resonance, 900);

  const submit = async () => {
    const text = draft.trim();
    if (!text || busy || tense) return;
    const all = [...answers, text];
    setAnswers(all);
    setDraft('');
    if (textRef.current) textRef.current.style.height = '';
    setBusy(true);
    const verdict = await judgeFeynman(zone, all.join('\n'));
    setBusy(false);
    setOffline(Boolean(verdict.offline));
    const next = Math.max(resonance, verdict.resonance);
    setResonance(next);
    onResonance(next);
    if (next >= 100) {
      setTense(true);
      setLine(verdict.reply || '……逻辑闭环。我找不到裂缝了。');
      setPlaceholder('共鸣已满，区域正在点亮');
      window.setTimeout(onComplete, reduced ? 0 : 750);
      return;
    }
    setLine([verdict.reply, verdict.followUp].filter(Boolean).join(' ') || '还不够。再说清楚一点。');
    setPlaceholder(verdict.followUp ? `守门人追问：${verdict.followUp} 试着补充这一点……` : DEFAULT_PLACEHOLDER);
    window.setTimeout(() => textRef.current?.focus(), 0);
  };

  const fitHeight = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    typingAt.current = performance.now();
    setDraft(event.target.value);
    fitHeight(event.target);
  };

  const insertTerm = (term: string) => {
    const el = textRef.current;
    if (!el || tense) return;
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + term + draft.slice(end);
    const caret = start + term.length;
    typingAt.current = performance.now();
    setDraft(next);
    setUsedTerms((prev) => (prev.includes(term) ? prev : [...prev, term]));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
      fitHeight(el);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className={`duel${tense ? ' tense' : ''}`}>
      <div className="duel-guardian">
        <div className="duel-avatar">
          <img src="/quest/boss.png" alt="" />
        </div>
        <div className="duel-id">
          <span className="duel-name">{boss.guardianName}</span>
          <span className="duel-resonance">
            共鸣度 <b>{readout}%</b>
            {offline ? <em>离线估算</em> : null}
          </span>
        </div>
        <button
          type="button"
          className={`clue-toggle${clueOpen ? ' open' : ''}`}
          aria-expanded={clueOpen}
          onClick={() => setClueOpen((open) => !open)}
        >
          ◈ {clueOpen ? '收起原典线索' : '调阅原典线索'}
        </button>
      </div>

      <p className="duel-line" aria-live="polite">
        {shown}
        <span className={`duel-caret${done ? ' idle' : ''}`} />
      </p>

      {clueOpen ? (
        <div className="clue-drawer">
          <span className="clue-tag">原典线索 · 看懂后收起，用自己的话复述</span>
          <p>{boss.referenceExplanation}</p>
        </div>
      ) : null}

      {answers.length > 0 ? (
        <ol className="duel-log">
          {answers.slice(-2).map((answer, i) => (
            <li key={`${answers.length}-${i}`}>{answer}</li>
          ))}
        </ol>
      ) : null}

      {capsules.length > 0 ? (
        <div className="concept-capsules" aria-label="概念胶囊，点击填入输入框">
          {capsules.map((term) => (
            <button
              key={term}
              type="button"
              className={`capsule${usedTerms.includes(term) ? ' used' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertTerm(term)}
              disabled={tense}
            >
              {term}
            </button>
          ))}
        </div>
      ) : null}

      <div className={`duel-input${busy ? ' busy' : ''}`} ref={inputWrap}>
        <textarea
          ref={textRef}
          rows={1}
          value={draft}
          placeholder={placeholder}
          onChange={onChange}
          onKeyDown={onKeyDown}
          disabled={tense}
          aria-label="向守门人解释"
          autoFocus
        />
        <button type="button" className="duel-send" onClick={() => void submit()} disabled={busy || tense || !draft.trim()} aria-label="发送共振">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <CornerDownLeft size={15} />}
        </button>
      </div>

      {createPortal(
        <ResonanceTether
          getSource={getSource}
          target={inputWrap}
          resonance={tense ? 100 : resonance}
          typingAt={typingAt}
          charging={busy}
          tense={tense}
          reduced={reduced}
        />,
        document.body,
      )}
    </div>
  );
};

// ----------------------------------------------------------------------------
// 地表探索页
// ----------------------------------------------------------------------------

export const ZoneExplorer = () => {
  const [params] = useSearchParams();
  const { scene, loaded, documents, rememberDocument } = useCosmos();
  const documentId = params.get('document') || localStorage.getItem(CURRENT_DOCUMENT_KEY);
  const currentDoc = documents.find((d) => d.id === documentId);
  const documentName =
    currentDoc?.name ||
    (localStorage.getItem(CURRENT_DOCUMENT_KEY) === documentId ? localStorage.getItem(CURRENT_DOCUMENT_NAME_KEY) : null) ||
    '未命名星球';

  useEffect(() => {
    if (currentDoc) rememberDocument({ id: currentDoc.id, name: currentDoc.name || currentDoc.id });
  }, [currentDoc, rememberDocument]);
  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  const [save, setSave] = useState<ZoneSave | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [syncFlash, setSyncFlash] = useState(false);
  const [lighting, setLighting] = useState<number | null>(null);
  const [muted, setMuted] = useState(() => scene?.audio.isMuted ?? true);
  const [flying, setFlying] = useState(false);
  const [companionReaction, setCompanionReaction] = useState<CompanionReaction | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const labelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const zoneAnchors = useRef<ZoneAnchor[]>([]);
  const timers = useRef<number[]>([]);

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const update = useCallback(
    (fn: (prev: ZoneSave) => ZoneSave) => {
      const prev = saveRef.current;
      if (!prev || !documentId) return;
      const next = fn(prev);
      saveRef.current = next;
      setSave(next);
      storeZoneSave(documentId, next);
    },
    [documentId],
  );

  const unlockZone = useCallback(
    (index: number) => {
      scene?.unlockZoneSequence(index);
      update((prev) => ({
        ...prev,
        zones: prev.zones.map((z, k) => (k === index && z.status === 'locked' ? { ...z, status: 'active' } : z)),
      }));
    },
    [scene, update],
  );

  const generate = useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    setError('');
    try {
      const fresh = await fetchZones(documentId);
      storeZoneSave(documentId, fresh);
      saveRef.current = fresh;
      setSave(fresh);
      setSelected(0);
      later(reduced ? 0 : 900, () => unlockZone(0));
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法扫描这颗星球');
    } finally {
      setLoading(false);
    }
  }, [documentId, later, reduced, unlockZone]);

  useEffect(() => {
    if (!documentId) return;
    const cached = loadZoneSave(documentId);
    if (!cached) {
      setSave(null);
      return;
    }
    const next = { ...cached, zones: ensureFrontier(cached.zones) };
    saveRef.current = next;
    setSave(next);
    storeZoneSave(documentId, next);
    const frontier = next.zones.findIndex((z) => z.status === 'active');
    setSelected(frontier >= 0 ? frontier : 0);
  }, [documentId]);

  // 首区秒开后，后台静默补齐其余区域；离开页面时结果直接写进本地缓存，下次进入 0 延迟
  const pendingZones = hasPendingZones(save);
  useEffect(() => {
    if (!documentId || !pendingZones) return;
    let cancelled = false;
    const run = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = saveRef.current ?? loadZoneSave(documentId);
        if (!current || !hasPendingZones(current)) return;
        try {
          const fresh = await fetchRestZones(documentId, current);
          if (!cancelled) {
            update((prev) => mergeRestZones(prev, fresh));
          } else {
            const cached = loadZoneSave(documentId);
            if (cached && hasPendingZones(cached)) storeZoneSave(documentId, mergeRestZones(cached, fresh));
          }
          return;
        } catch {
          // 再试一次，仍失败就放弃占位；页面已离开就留给下次进入重试
          if (cancelled) return;
        }
      }
      if (!cancelled) update((prev) => dropPendingZones(prev));
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [documentId, pendingZones, update]);

  useEffect(() => {
    if (!documentId || !loaded || save || loading || error) return;
    if (saveRef.current || loadZoneSave(documentId)) return;
    void generate();
  }, [documentId, loaded, save, loading, error, generate]);

  useEffect(() => {
    if (!scene || !documentId || !save) return;
    scene.setSurfaceZones(
      documentId,
      save.zones.map((z) => ({ id: z.id, title: z.title, status: z.status })),
    );
  }, [scene, documentId, save]);

  useEffect(() => {
    if (!scene || !documentId || !loaded) return;
    scene.setExploreMode(documentId);
    setMuted(scene.audio.isMuted);
    return () => scene.setExploreMode(null);
  }, [scene, documentId, loaded]);

  useEffect(() => {
    scene?.setZoneFocus(selected);
  }, [scene, selected]);

  useEffect(() => {
    if (!scene) return;
    scene.setCallbacks({
      onZoneClick: (index) => setSelected(index),
      onZoneAnchors: (list) => {
        zoneAnchors.current = list;
        list.forEach((anchor, i) => {
          const el = labelRefs.current[i];
          if (!el) return;
          el.style.transform = `translate3d(${anchor.x.toFixed(1)}px, ${anchor.y.toFixed(1)}px, 0)`;
          el.style.opacity = anchor.visible ? '1' : '0';
          el.style.pointerEvents = anchor.visible ? 'auto' : 'none';
        });
      },
    });
    return () => scene.setCallbacks({ onZoneClick: undefined, onZoneAnchors: undefined });
  }, [scene]);

  const getSource = useCallback((): ScreenPoint | null => {
    const index = selectedRef.current;
    if (index == null) return null;
    const anchor = zoneAnchors.current[index];
    return anchor ? { x: anchor.x, y: anchor.y, visible: anchor.visible } : null;
  }, []);

  const setPhase = (zone: KnowledgeZone, phase: ZonePhase) =>
    update((prev) => ({ ...prev, phases: { ...prev.phases, [zone.id]: phase } }));

  const markBriefed = (zone: KnowledgeZone) =>
    update((prev) => ({ ...prev, briefed: { ...prev.briefed, [zone.id]: true } }));

  const setResonance = (zone: KnowledgeZone, value: number) =>
    update((prev) => ({ ...prev, resonance: { ...prev.resonance, [zone.id]: value } }));

  const completeZone = (index: number) => {
    const current = saveRef.current;
    if (!current || current.zones[index]?.status === 'completed') return;
    scene?.completeZoneSequence(index);
    setCompanionReaction({ kind: 'cheer', key: performance.now(), bubble: '区域净化！✨' });
    setLighting(index);
    setSyncFlash(true);
    later(1200, () => setSyncFlash(false));
    update((prev) => ({
      ...prev,
      zones: prev.zones.map((z, k) => (k === index ? { ...z, status: 'completed' } : z)),
    }));
    later(reduced ? 0 : CLIMAX_MS, () => {
      setLighting(null);
      const next = saveRef.current?.zones[index + 1];
      if (next && next.status === 'locked') unlockZone(index + 1);
    });
  };

  const rescan = () => {
    if (!documentId) return;
    clearZoneSave(documentId);
    scene?.clearSurfaceZones();
    setSave(null);
    setSelected(null);
    setError('');
    // 预置星清掉存档后 loadZoneSave 仍回落到满进度版本，需要主动从第一区重开
    if (getPresetPlanet(documentId)) void generate();
  };

  const zones = save?.zones ?? [];
  const rate = syncRate(zones, save);
  const rateShown = useAnimatedNumber(rate, 1200);
  const zone = selected != null ? zones[selected] : undefined;
  const phase = (zone && save?.phases[zone.id]) || 0;
  const allDone = zones.length > 0 && zones.every((z) => z.status === 'completed');

  if (!documentId) {
    return (
      <div className="landing-root orbit-stage explore-stage">
        <div className="landing-ui on">
          <div className="zone-capsule">
            <p>先回星系选一颗星球，再降落到地表。</p>
            <Link to="/chat" className="btn btn-primary">回到星系</Link>
          </div>
        </div>
      </div>
    );
  }

  if (flying && scene && save) {
    return (
      <div className="landing-root orbit-stage explore-stage surface-stage">
        <SurfaceRun
          scene={scene}
          documentId={documentId}
          planetName={currentDoc?.planetName || documentName}
          save={save}
          update={update}
          reduced={reduced}
          onExit={() => setFlying(false)}
        />
      </div>
    );
  }

  return (
    <div className="landing-root orbit-stage explore-stage">
      <div className={`climax-veil${lighting != null ? ' on' : ''}`} aria-hidden="true" />

      <div className="landing-ui on">
        <header className="landing-header">
          <Link className="landing-logo" to="/chat" aria-label="返回星系">
            AI 导师
          </Link>
          <div className={`sync-meter hud-glass${syncFlash ? ' flash' : ''}`}>
            <span className="sync-label">星球同步率</span>
            <span className="sync-track">
              <i style={{ width: `${rate}%` }} />
            </span>
            <b>{rateShown}%</b>
          </div>
          <div className="explore-actions">
            <button
              type="button"
              className="pill hud-pill"
              aria-label={muted ? '开启音效' : '关闭音效'}
              onClick={() => setMuted(scene?.toggleMute() ?? true)}
            >
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <OrbitModes documentId={documentId} />
          </div>
        </header>

        <div className="zone-labels">
          {zones.map((z, i) => (
            <button
              key={z.id}
              type="button"
              ref={(el) => {
                labelRefs.current[i] = el;
              }}
              className={`zone-label ${z.status}${selected === i ? ' selected' : ''}`}
              onClick={() => setSelected(i)}
            >
              <span className="zone-label-kicker">ZONE // {String(i + 1).padStart(2, '0')}</span>
              <span className="zone-label-name">{z.status === 'locked' ? '▒▒ 迷雾区域' : z.title}</span>
            </button>
          ))}
        </div>

        {save ? <HoloCompanion progress={rate} reaction={companionReaction} reduced={reduced} className="in-orbit" /> : null}

        <aside className="zone-capsule">
          <p className="eyebrow">
            地表探索 · {documentName}
            {pendingZones ? <span className="zone-backfill"> · 其余区域后台生成中</span> : null}
          </p>

          {save && !loading && scene ? (
            <button type="button" className="surface-launch" onClick={() => setFlying(true)}>
              <Plane size={14} />
              {allDone ? '降落地表 · 纯享漫游' : '降落地表 · 穿门航行'}
            </button>
          ) : null}

          {loading ? (
            <div className="zone-scan">
              <Loader2 size={18} className="animate-spin" />
              <p>正在扫描星球地表，标定知识区域……</p>
            </div>
          ) : error ? (
            <div className="zone-scan">
              <p className="shelf-error">{error}</p>
              <button type="button" className="btn btn-primary" onClick={() => void generate()}>
                重新扫描
              </button>
            </div>
          ) : !zone ? (
            <p className="zone-hint">点击星球表面的信标，选择一个知识区域。</p>
          ) : (
            <>
              <div className="zone-head">
                <span className={`zone-chip ${zone.status}`}>{STATUS_LABEL[zone.status]}</span>
                <h2>{zone.status === 'locked' ? '迷雾区域' : zone.title}</h2>
                {zone.status !== 'locked' && zone.summary ? <p>{zone.summary}</p> : null}
              </div>

              {zone.pending && zone.status !== 'locked' ? (
                <div className="zone-scan">
                  <Loader2 size={18} className="animate-spin" />
                  <p>这片区域还在后台扫描，数据到了会自动接上。可以先降落地表穿门航行。</p>
                </div>
              ) : zone.status === 'locked' ? (
                <p className="zone-hint">迷雾封锁。净化上一个区域后，这里的信标才会升起。</p>
              ) : zone.status === 'completed' ? (
                <div className="zone-done">
                  <p className="zone-step-kicker">核心知识星碑</p>
                  <p>{zone.monolithNote || zone.feynmanBoss.referenceExplanation}</p>
                  {allDone ? (
                    <p className="zone-final">整颗星球已完全点亮。</p>
                  ) : selected != null && zones[selected + 1] && zones[selected + 1].status !== 'locked' ? (
                    <button type="button" className="btn btn-primary" onClick={() => setSelected(selected + 1)}>
                      前往下一个区域
                    </button>
                  ) : null}
                </div>
              ) : phase === 0 && !save?.briefed[zone.id] ? (
                <IntelBriefCard key={`${zone.id}-brief`} zone={zone} onStart={() => markBriefed(zone)} />
              ) : (
                <>
                  <ol className="zone-phases">
                    {PHASES.map((label, k) => (
                      <li key={label} className={k < phase ? 'done' : k === phase ? 'current' : ''}>
                        <span>{String(k + 1).padStart(2, '0')}</span>
                        {label}
                      </li>
                    ))}
                  </ol>

                  {phase === 0 ? (
                    <ChoiceStep
                      key={`${zone.id}-0`}
                      kicker="信号降噪 · 这条信号与文档一致吗？"
                      prompt={zone.calibration.statement}
                      options={[
                        { label: '信号 · 与文档一致', correct: zone.calibration.isSignal },
                        { label: '噪声 · 被扭曲的说法', correct: !zone.calibration.isSignal },
                      ]}
                      why={zone.calibration.why}
                      reduced={reduced}
                      onPass={() => setPhase(zone, 1)}
                    />
                  ) : phase === 1 ? (
                    <ChoiceStep
                      key={`${zone.id}-1`}
                      kicker="逻辑接驳 · 接通正确的回路"
                      prompt={zone.circuit.q}
                      options={zone.circuit.options.map((option) => ({
                        label: option,
                        correct: option === zone.circuit.answer,
                      }))}
                      why={zone.circuit.why}
                      reduced={reduced}
                      onPass={() => setPhase(zone, 2)}
                    />
                  ) : (
                    <FeynmanDuel
                      key={`${zone.id}-2`}
                      zone={zone}
                      capsules={capsulesFor(zone, zones)}
                      initialResonance={save?.resonance[zone.id] ?? 0}
                      reduced={reduced}
                      getSource={getSource}
                      onTick={() => scene?.audio.playTick()}
                      onResonance={(value) => setResonance(zone, value)}
                      onComplete={() => completeZone(zones.findIndex((z) => z.id === zone.id))}
                    />
                  )}
                </>
              )}
            </>
          )}

          {save && !loading ? (
            <button type="button" className="zone-rescan" onClick={rescan}>
              <RotateCcw size={12} /> 重新扫描地表{save.source === 'quest' ? '（当前为闯关任务线降级数据）' : ''}
            </button>
          ) : null}
        </aside>
      </div>
    </div>
  );
};
