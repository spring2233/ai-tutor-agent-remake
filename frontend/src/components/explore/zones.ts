import type { ZoneStatus } from '../../cosmos/planetSurface';
import { storePlanetMeta } from '../../cosmos/planetIdentity';
import { createPresetZoneSave, getPresetPlanet } from '../../cosmos/presetPlanets';
import { PRESET_GATES } from '../../cosmos/presetGates';

export type { ZoneStatus };

export interface Calibration {
  statement: string;
  isSignal: boolean;
  why: string;
}

export interface Circuit {
  q: string;
  options: string[];
  answer: string;
  why: string;
}

export interface FeynmanBoss {
  guardianName: string;
  challengePrompt: string;
  keyPoints: string[];
  followUpHint: string;
  referenceExplanation: string;
  /** 概念胶囊里的关键术语（2~3 个）与一个干扰词；旧存档可能没有。 */
  terms?: string[];
  decoyTerm?: string;
}

/** 双生光门：一句核心论断与一句对称的领域误区；`probe` 是选错时守门人的反问点拨。 */
export interface TwinGate {
  truth: string;
  trap: string;
  probe: string;
  /** 一句解释论断为何成立的学习笔记，用于章节知识星碑。 */
  note?: string;
}

/** 首区秒开时后端给出的区域规划。 */
export interface ZoneOutlineItem {
  title: string;
  summary: string;
}

/** 地表穿门进度：已答对的光门序号与本区光门总数。 */
export interface GateProgress {
  done: number[];
  total: number;
}

/** 战前 30 秒扫描档案：3 条大白话结论 + 1 个生活类比。 */
export interface IntelBrief {
  conclusions: string[];
  analogy: string;
}

export interface KnowledgeZone {
  id: string;
  /** 章节知识主题名（主字段，与 title 同步兼容） */
  zoneTitle: string;
  title: string;
  /** 简短知识介绍（主字段，与 summary 同步兼容） */
  zoneIntro: string;
  summary?: string;
  /** 0~100 章节区域探索进度 */
  progress: number;
  /** 核心知识星碑笔记（区域点亮后凝结的知识铭文） */
  monolithNote?: string;
  intel?: IntelBrief;
  status: ZoneStatus;
  calibration: Calibration;
  circuit: Circuit;
  feynmanBoss: FeynmanBoss;
  /** 旧存档和预置星没有这份数据，用 `gatesFor` 取。 */
  gates?: TwinGate[];
  /** 首区秒开时的占位区域：只有标题，完整数据还在后台生成。 */
  pending?: boolean;
}

/** 0 信号降噪 · 1 逻辑接驳 · 2 费曼对线 */
export type ZonePhase = 0 | 1 | 2;

export interface ZoneSave {
  zones: KnowledgeZone[];
  phases: Record<string, ZonePhase>;
  resonance: Record<string, number>;
  /** 已读过扫描档案的区域，读过后直接进入信号校准。 */
  briefed: Record<string, boolean>;
  /** 地表穿门进度，按区域 id。 */
  gates?: Record<string, GateProgress>;
  /** 区域规划；还有 pending 区域时，后台按它补齐。 */
  outline?: ZoneOutlineItem[];
  source: 'llm' | 'quest' | 'preset';
}

export interface FeynmanVerdict {
  resonance: number;
  reply: string;
  followUp: string;
  offline?: boolean;
}

export const ZONES_UPDATED_EVENT = 'cognita:zones-updated';

const zoneKey = (documentId: string) => `ai-tutor-zones-v1:${documentId}`;
const questKey = (documentId: string) => `ai-tutor-quest-v2:${documentId}`;

export function computeZoneProgress(
  zone: Pick<KnowledgeZone, 'id' | 'status'>,
  phases: Record<string, ZonePhase> = {},
  briefed: Record<string, boolean> = {},
  resonance: Record<string, number> = {},
  gates: Record<string, GateProgress> = {},
): number {
  if (zone.status === 'completed') return 100;
  if (zone.status === 'locked') return 0;
  const gate = gates[zone.id];
  const flown = gate && gate.total > 0 ? Math.min(97, 12 + Math.round((85 * gate.done.length) / gate.total)) : 0;
  const phase = phases[zone.id] ?? 0;
  let staged: number;
  if (phase === 0) {
    staged = briefed[zone.id] ? 28 : 12;
  } else if (phase === 1) {
    staged = 54;
  } else {
    const res = Math.max(0, Math.min(100, resonance[zone.id] ?? 0));
    staged = Math.min(97, 72 + Math.round(res * 0.25));
  }
  return Math.max(staged, flown);
}

function cleanGates(raw: unknown): TwinGate[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const gates = raw
    .filter((g): g is TwinGate => Boolean(g && typeof g.truth === 'string' && typeof g.trap === 'string'))
    .map((g) => {
      const gate: TwinGate = { truth: g.truth.trim(), trap: g.trap.trim(), probe: String(g.probe ?? '').trim() };
      const note = String(g.note ?? '').trim();
      return note ? { ...gate, note } : gate;
    })
    .filter((g) => g.truth && g.trap && g.truth !== g.trap);
  return gates.length ? gates : undefined;
}

export function hydrateZones(
  rawZones: Partial<KnowledgeZone>[],
  phases: Record<string, ZonePhase> = {},
  briefed: Record<string, boolean> = {},
  resonance: Record<string, number> = {},
  gates: Record<string, GateProgress> = {},
): KnowledgeZone[] {
  return rawZones.map((raw, idx) => {
    const id = raw.id || `zone-${idx + 1}`;
    const status: ZoneStatus =
      raw.status === 'completed' || raw.status === 'active' || raw.status === 'locked'
        ? raw.status
        : 'locked';
    const zoneTitle = (raw.zoneTitle || raw.title || `知识区域 ${idx + 1}`).trim();
    const zoneIntro = (
      raw.zoneIntro ||
      raw.summary ||
      raw.intel?.conclusions?.[0] ||
      '探索该章节的核心概念与逻辑脉络。'
    ).trim();
    const boss: FeynmanBoss = raw.feynmanBoss ?? {
      guardianName: 'GUARDIAN // 熵增逻辑体',
      challengePrompt: `请用你自己的话解释「${zoneTitle}」的核心机制。`,
      keyPoints: [zoneTitle, zoneIntro],
      followUpHint: '这两个概念之间是如何产生因果联系的？',
      referenceExplanation: zoneIntro,
    };
    const progress = computeZoneProgress({ id, status }, phases, briefed, resonance, gates);
    const monolithNote = (raw.monolithNote || boss.referenceExplanation || zoneIntro).trim();
    return {
      id,
      zoneTitle,
      title: zoneTitle,
      zoneIntro,
      summary: zoneIntro,
      progress,
      monolithNote,
      intel: raw.intel,
      status,
      calibration: raw.calibration ?? {
        statement: zoneIntro,
        isSignal: true,
        why: boss.referenceExplanation,
      },
      circuit: raw.circuit ?? {
        q: `关于「${zoneTitle}」，下列哪项陈述切中核心？`,
        options: [zoneIntro, '与上下文毫无关联', '完全随机的噪声假设', '无需任何前置条件'],
        answer: zoneIntro,
        why: boss.referenceExplanation,
      },
      feynmanBoss: boss,
      gates: cleanGates(raw.gates),
      ...(raw.pending ? { pending: true } : {}),
    };
  });
}

function notifyZonesUpdated(documentId: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ZONES_UPDATED_EVENT, { detail: { documentId } }));
  }
}

export function loadZoneSave(documentId: string): ZoneSave | null {
  if (!documentId) return null;
  try {
    const raw = localStorage.getItem(zoneKey(documentId));
    if (raw) {
      const data = JSON.parse(raw) as Partial<ZoneSave>;
      if (Array.isArray(data.zones) && data.zones.length > 0) {
        const phases = data.phases ?? {};
        const resonance = data.resonance ?? {};
        const briefed = data.briefed ?? {};
        const gates = data.gates ?? {};
        return {
          zones: hydrateZones(data.zones, phases, briefed, resonance, gates),
          phases,
          resonance,
          briefed,
          gates,
          ...(data.outline ? { outline: data.outline } : {}),
          source: data.source ?? 'llm',
        };
      }
    }
  } catch {
    // ignore malformed save
  }
  const preset = getPresetPlanet(documentId);
  if (preset) {
    return createPresetZoneSave(preset, true);
  }
  return null;
}

export function storeZoneSave(documentId: string, save: ZoneSave) {
  const hydrated: ZoneSave = {
    ...save,
    zones: hydrateZones(save.zones, save.phases, save.briefed, save.resonance, save.gates),
  };
  localStorage.setItem(zoneKey(documentId), JSON.stringify(hydrated));
  notifyZonesUpdated(documentId);
}

export function clearZoneSave(documentId: string) {
  localStorage.removeItem(zoneKey(documentId));
  notifyZonesUpdated(documentId);
}

/** 计算星球总体学习进度 (0~100)，兼容细粒度阶段进度与完成率。 */
export function syncRate(
  zones: KnowledgeZone[],
  save?: Pick<ZoneSave, 'phases' | 'briefed' | 'resonance' | 'gates'> | null,
): number {
  if (!zones.length) return 0;
  if (zones.every((z) => z.status === 'completed')) return 100;
  if (zones.every((z) => z.status === 'locked')) return 0;
  const total = zones.reduce((acc, z) => {
    const p = save
      ? computeZoneProgress(z, save.phases, save.briefed, save.resonance, save.gates)
      : typeof z.progress === 'number'
        ? z.progress
        : z.status === 'completed'
          ? 100
          : z.status === 'active'
            ? 12
            : 0;
    return acc + p;
  }, 0);
  const avg = Math.round(total / zones.length);
  return Math.max(4, Math.min(99, avg));
}

export function getDocumentProgress(documentId: string): number {
  const save = loadZoneSave(documentId);
  if (!save) return 0;
  return syncRate(save.zones, save);
}

/** 首个未完成区域保持 active，避免旧存档里没有任何可进入的区域。 */
export function ensureFrontier(zones: KnowledgeZone[]) {
  if (zones.some((z) => z.status === 'active')) return zones;
  const next = zones.findIndex((z) => z.status !== 'completed');
  if (next < 0) return zones;
  return zones.map((z, i) =>
    i === next ? { ...z, status: 'active' as const, progress: Math.max(z.progress || 0, 12) } : z,
  );
}

function unique(texts: (string | undefined)[]) {
  const out: string[] = [];
  texts.forEach((text) => {
    const t = text?.trim();
    if (t && !out.includes(t)) out.push(t);
  });
  return out;
}

/** 扫描档案；旧存档或模型漏写时用摘要和要点补齐 3 条。 */
export function intelFor(zone: KnowledgeZone): IntelBrief {
  return {
    conclusions: unique([
      ...(zone.intel?.conclusions ?? []),
      zone.zoneIntro || zone.summary,
      ...zone.feynmanBoss.keyPoints,
    ]).slice(0, 3),
    analogy: zone.intel?.analogy?.trim() ?? '',
  };
}

/** 要点是整句时，取第一个分句当术语。 */
function termOf(point: string) {
  return point.split(/[，。,；;：:、（(\s]/)[0].slice(0, 10);
}

function hashText(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 费曼对线的概念胶囊：2~3 个关键术语 + 1 个干扰词，顺序按区域固定打乱。 */
export function capsulesFor(zone: KnowledgeZone, zones: KnowledgeZone[]): string[] {
  const boss = zone.feynmanBoss;
  let terms = unique(boss.terms ?? []).slice(0, 3);
  if (terms.length < 2) terms = unique([...terms, ...boss.keyPoints.map(termOf)]).slice(0, 3);
  const decoy =
    boss.decoyTerm?.trim() ||
    zones
      .filter((z) => z.id !== zone.id)
      .flatMap((z) => z.feynmanBoss.terms ?? [z.zoneTitle || z.title])
      .find((t) => t && !terms.includes(t));
  const all = decoy && !terms.includes(decoy) ? [...terms, decoy] : terms;
  return [...all].sort((a, b) => hashText(zone.id + a) - hashText(zone.id + b));
}

async function postJson<T>(url: string, body: unknown, timeoutMs?: number): Promise<T> {
  const controller = new AbortController();
  const timer = timeoutMs ? window.setTimeout(() => controller.abort(), timeoutMs) : 0;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { detail?: string }).detail || `请求失败（${res.status}）`);
    return data as T;
  } finally {
    window.clearTimeout(timer);
  }
}

/** 守门人回应超过这个时间就改用本地估算，对线节奏不能被模型延迟卡死。 */
const FEYNMAN_TIMEOUT_MS = 40_000;

interface CachedQuest {
  areas?: {
    id: string;
    title: string;
    summary?: string;
    tasks: { concept: string; q: string; options: string[]; answer: string; why: string }[];
  }[];
}

/** 降级：后端生成失败时，用已缓存的闯关任务线拼出地表区域。 */
export function zonesFromQuest(documentId: string): KnowledgeZone[] | null {
  let quest: CachedQuest | null = null;
  try {
    quest = JSON.parse(localStorage.getItem(questKey(documentId)) || 'null') as CachedQuest | null;
  } catch {
    return null;
  }
  const areas = quest?.areas?.filter((a) => a.tasks?.length >= 2) ?? [];
  if (areas.length < 3) return null;
  return areas.slice(0, 6).map((area, index) => {
    const [first, second] = area.tasks;
    const wrong = first.options.find((o) => o !== first.answer);
    const honest = index % 2 === 0 || !wrong;
    const decoy = areas[(index + 1) % areas.length].tasks[0]?.concept;
    const intro = area.summary || `${first.concept} 与 ${second.concept} 的核心逻辑联结。`;
    const refExp = [area.summary, first.why, second.why].filter(Boolean).join(' ');
    return {
      id: `zone-${index + 1}`,
      zoneTitle: area.title,
      title: area.title,
      zoneIntro: intro,
      summary: intro,
      progress: 0,
      monolithNote: refExp,
      intel: { conclusions: unique([area.summary, first.why, second.why]).slice(0, 3), analogy: '' },
      status: 'locked',
      calibration: {
        statement: `${first.q} —— ${honest ? first.answer : wrong}`,
        isSignal: honest,
        why: first.why,
      },
      circuit: { q: second.q, options: second.options, answer: second.answer, why: second.why },
      feynmanBoss: {
        guardianName: 'GUARDIAN // 熵增逻辑体',
        challengePrompt: `「${area.title}」不过是几个名词的堆砌。你能不用术语，讲清「${first.concept}」和「${second.concept}」到底是怎么连起来的吗？`,
        keyPoints: [first.concept, second.concept, area.summary || area.title].filter(Boolean).slice(0, 3),
        followUpHint: `如果没有「${first.concept}」，「${second.concept}」还成立吗？`,
        referenceExplanation: refExp,
        terms: unique([first.concept, second.concept]),
        decoyTerm: decoy && decoy !== first.concept && decoy !== second.concept ? decoy : undefined,
      },
    };
  });
}

interface ZonesResponse {
  zones: Partial<KnowledgeZone>[];
  outline?: ZoneOutlineItem[] | null;
  planetMeta?: { planetName?: string; themeCategory?: 'ai_cs' | 'physics_math' | 'bio_med' | 'humanities'; themeSummary?: string };
}

/**
 * 首区秒开：先只要星球简介 + 区域规划 + 第 1 区，其余区域以 `pending` 占位，由 `fetchRestZones` 在后台补齐。
 * 分段接口失败时退回一次性生成，再失败退回闯关任务线。
 */
export async function fetchZones(documentId: string): Promise<ZoneSave> {
  const preset = getPresetPlanet(documentId);
  if (preset) {
    return createPresetZoneSave(preset, false);
  }
  try {
    const data = await postJson<ZonesResponse>('/api/zones', { document_id: documentId, stage: 'first' });
    if (!Array.isArray(data.zones) || data.zones.length === 0) throw new Error('没有生成知识区域');
    if (data.planetMeta) storePlanetMeta(documentId, data.planetMeta);
    const outline = (data.outline ?? []).filter((o) => o?.title);
    const placeholders: Partial<KnowledgeZone>[] = outline.slice(data.zones.length).map((o, k) => ({
      id: `zone-${data.zones.length + k + 1}`,
      title: o.title,
      zoneTitle: o.title,
      summary: o.summary,
      zoneIntro: o.summary,
      pending: true,
    }));
    const zones = hydrateZones([...data.zones, ...placeholders].map((z) => ({ ...z, status: 'locked' })));
    return { zones, phases: {}, resonance: {}, briefed: {}, outline, source: 'llm' };
  } catch {
    // 落到一次性生成
  }
  try {
    const data = await postJson<ZonesResponse>('/api/zones', { document_id: documentId });
    if (!Array.isArray(data.zones) || data.zones.length === 0) throw new Error('没有生成知识区域');
    if (data.planetMeta) storePlanetMeta(documentId, data.planetMeta);
    const zones = hydrateZones(data.zones.map((z) => ({ ...z, status: 'locked' })));
    return { zones, phases: {}, resonance: {}, briefed: {}, source: 'llm' };
  } catch (err) {
    const fallback = zonesFromQuest(documentId);
    if (fallback) return { zones: fallback, phases: {}, resonance: {}, briefed: {}, source: 'quest' };
    throw err;
  }
}

export function hasPendingZones(save: ZoneSave | null | undefined) {
  return Boolean(save?.zones.some((z) => z.pending));
}

const restInflight = new Map<string, Promise<Partial<KnowledgeZone>[]>>();

/** 后台补齐 pending 区域；返回按规划生成的完整区域（id 接在已就绪区域之后）。同一星球并发调用共用一个请求。 */
export function fetchRestZones(documentId: string, save: ZoneSave): Promise<Partial<KnowledgeZone>[]> {
  const running = restInflight.get(documentId);
  if (running) return running;
  const start = save.zones.findIndex((z) => z.pending);
  if (start < 0) return Promise.resolve([]);
  const outline = save.zones.slice(start).map((z) => ({ title: z.zoneTitle || z.title, summary: z.zoneIntro || '' }));
  const request = postJson<ZonesResponse>('/api/zones', { document_id: documentId, stage: 'rest', outline, start })
    .then((data) => {
      if (!Array.isArray(data.zones) || data.zones.length === 0) throw new Error('没有生成剩余区域');
      return data.zones;
    })
    .finally(() => restInflight.delete(documentId));
  restInflight.set(documentId, request);
  return request;
}

/** 把后台补齐的区域按 id 换掉占位，保留玩家已推进的状态；没补上的占位直接移除，星球照样能通关。 */
export function mergeRestZones(prev: ZoneSave, fresh: Partial<KnowledgeZone>[]): ZoneSave {
  const byId = new Map(fresh.map((z) => [z.id, z]));
  const merged: Partial<KnowledgeZone>[] = [];
  prev.zones.forEach((zone) => {
    if (!zone.pending) {
      merged.push(zone);
      return;
    }
    const loaded = byId.get(zone.id);
    if (loaded) merged.push({ ...loaded, status: zone.status, pending: false });
  });
  const zones = ensureFrontier(hydrateZones(merged, prev.phases, prev.briefed, prev.resonance, prev.gates));
  return { ...prev, zones };
}

/** 后台补齐彻底失败：丢掉占位，让已就绪的区域构成完整星球。 */
export function dropPendingZones(prev: ZoneSave): ZoneSave {
  const zones = prev.zones.filter((z) => !z.pending);
  return { ...prev, zones: ensureFrontier(zones) };
}

function tokens(text: string) {
  const lower = text.toLowerCase();
  const words = lower.match(/[a-z0-9_]{3,}/g) ?? [];
  const cjk = lower.replace(/[^\u4e00-\u9fff]/g, '');
  const grams: string[] = [];
  for (let i = 0; i < cjk.length - 1; i += 1) grams.push(cjk.slice(i, i + 2));
  return [...new Set([...words, ...grams])];
}

/** 降级：评估接口不可用时，按要点词覆盖率在本地估算共鸣度。 */
export function localFeynmanVerdict(boss: FeynmanBoss, answer: string): FeynmanVerdict {
  const text = answer.toLowerCase();
  const scores = boss.keyPoints.map((point): number => {
    const parts = tokens(point);
    if (!parts.length) return 0;
    const hit = parts.filter((p) => text.includes(p)).length / parts.length;
    return hit >= 0.5 ? 1 : hit >= 0.25 ? 0.5 : 0;
  });
  let resonance = Math.round((scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length)) * 100);
  if (answer.trim().length < 12) resonance = Math.min(resonance, 30);
  if (resonance >= 90) resonance = 100;
  const weakest = boss.keyPoints[scores.indexOf(Math.min(...scores))];
  return {
    resonance,
    reply: resonance === 100 ? '……逻辑闭环。我无法再找到裂缝。' : '有点意思，但你的解释里还有一段真空。',
    followUp: resonance === 100 ? '' : boss.followUpHint || `「${weakest}」这一点，你还没讲透。`,
    offline: true,
  };
}

// ----------------------------------------------------------------------------
// 地表双生光门
// ----------------------------------------------------------------------------

function closestByLength(target: string, pool: string[]) {
  return [...pool].sort((a, b) => Math.abs(a.length - target.length) - Math.abs(b.length - target.length))[0];
}

/** 旧存档没有光门：用逻辑接驳题的答案配长度最接近的干扰项，信号校准的噪声句作为误区。 */
function fallbackGates(zone: KnowledgeZone): TwinGate[] {
  const probe = zone.feynmanBoss.followUpHint || zone.circuit.why;
  const gates: TwinGate[] = [];
  const wrong = zone.circuit.options.filter((o) => o !== zone.circuit.answer);
  if (wrong.length) gates.push({ truth: zone.circuit.answer, trap: closestByLength(zone.circuit.answer, wrong), probe });
  if (!zone.calibration.isSignal) {
    gates.push({ truth: zone.intel?.conclusions?.[0] || zone.zoneIntro, trap: zone.calibration.statement, probe });
  }
  const term = zone.feynmanBoss.terms?.[0];
  const decoy = zone.feynmanBoss.decoyTerm;
  if (term && decoy && term !== decoy) {
    gates.push({ truth: `「${term}」是本区的关键概念`, trap: `「${decoy}」是本区的关键概念`, probe });
  }
  return gates;
}

export function gatesFor(documentId: string, zone: KnowledgeZone): TwinGate[] {
  if (zone.pending) return [];
  const preset = PRESET_GATES[documentId]?.[zone.id];
  if (preset?.length) return preset;
  if (zone.gates?.length) return zone.gates;
  return fallbackGates(zone);
}

/** 章节波次里每道门考察的层次：定义 → 机制 → 细节/误区 → 应用。 */
export const CODEX_LABELS = ['核心定义', '底层机制', '关键细节', '应用边界'];

export interface CodexRow {
  label: string;
  truth: string;
  note?: string;
}

/** 章节知识星碑：把本区 3~4 道光门的正确论断整理成结构化笔记。 */
export function codexFor(documentId: string, zone: KnowledgeZone): CodexRow[] {
  return gatesFor(documentId, zone).map((gate, i) => ({
    label: CODEX_LABELS[i] ?? `要点 ${i + 1}`,
    truth: gate.truth,
    note: gate.note,
  }));
}

/** 纯享漫游沿途记忆星碑上的一张知识卡片。 */
export interface ReviewCard {
  zoneIndex: number;
  chapter: string;
  label: string;
  text: string;
  note?: string;
}

/**
 * 汇总全部章节的通关要点，按章节顺序给出 `min`~`max` 张卡片：
 * 光门论断优先，太多时等距抽样，太少时用星碑铭文、扫描结论和费曼要点补齐。
 */
export function reviewCardsFor(documentId: string, zones: KnowledgeZone[], min = 8, max = 12): ReviewCard[] {
  const live = zones.map((zone, zoneIndex) => ({ zone, zoneIndex })).filter(({ zone }) => !zone.pending);
  let cards: ReviewCard[] = live.flatMap(({ zone, zoneIndex }) =>
    codexFor(documentId, zone).map((row) => ({ zoneIndex, chapter: zone.title, label: row.label, text: row.truth, note: row.note })),
  );
  if (cards.length > max) {
    const pool = cards;
    cards = Array.from({ length: max }, (_, i) => pool[Math.round((i * (pool.length - 1)) / (max - 1))]);
  }
  if (cards.length < min) {
    const extras = live.map(({ zone, zoneIndex }) => {
      const list: ReviewCard[] = [];
      const push = (label: string, text?: string) => {
        const t = text?.trim();
        if (t && !cards.some((c) => c.text === t) && !list.some((c) => c.text === t)) {
          list.push({ zoneIndex, chapter: zone.title, label, text: t });
        }
      };
      push('星碑铭文', zone.monolithNote);
      zone.intel?.conclusions.forEach((c) => push('扫描结论', c));
      zone.feynmanBoss.keyPoints.forEach((k) => push('费曼要点', k));
      return list;
    });
    for (let round = 0; cards.length < min && extras.some((l) => l.length > round); round += 1) {
      extras.forEach((list) => {
        if (cards.length < min && list[round]) cards.push(list[round]);
      });
    }
    cards.sort((a, b) => a.zoneIndex - b.zoneIndex);
  }
  return cards;
}

const collectedKey = 'ai-tutor-gallery-collected-v1';
const masterKey = (documentId: string) => `ai-tutor-master-badge-v1:${documentId}`;

export function isCollected(documentId: string) {
  try {
    return (JSON.parse(localStorage.getItem(collectedKey) || '[]') as string[]).includes(documentId);
  } catch {
    return false;
  }
}

export function markCollected(documentId: string) {
  if (isCollected(documentId)) return;
  let list: string[] = [];
  try {
    list = JSON.parse(localStorage.getItem(collectedKey) || '[]') as string[];
  } catch {
    list = [];
  }
  localStorage.setItem(collectedKey, JSON.stringify([...list, documentId]));
}

export function hasMasterBadge(documentId: string) {
  return localStorage.getItem(masterKey(documentId)) === '1';
}

export function grantMasterBadge(documentId: string) {
  localStorage.setItem(masterKey(documentId), '1');
}

// ----------------------------------------------------------------------------
// 费曼终极试炼：复用 /ask 的 /api/chat 问答接口
// ----------------------------------------------------------------------------

export interface TrialVerdict {
  persuaded: boolean;
  reply: string;
  /** 回答依据：上传文档 / 网页结果 / 本地估算。 */
  source: 'document' | 'web' | 'offline';
}

const VERDICT_LINE = /判定\s*[:：]\s*(已说服|未说服)/;

export async function askGuardianTrial(args: {
  documentId: string;
  planetName: string;
  guardian: string;
  claims: string[];
  truths: string[];
  answer: string;
  lastReply?: string;
}): Promise<TrialVerdict> {
  const question = [
    `我正在挑战知识星球${args.planetName}的${args.guardian}（费曼终极试炼）。`,
    `守门人的立论：${args.claims.map((c) => `「${c}」`).join('；')}。`,
    args.lastReply ? `守门人上一轮的回应：${args.lastReply}` : '',
    `我的反驳：${args.answer}`,
    '请扮演守门人，依据文档内容评判我的反驳：先用一两句承认我说对的地方，再针对最薄弱的一处追问一句；如果我已经完全驳倒立论就不要追问。',
    '最后单独一行只写「判定：已说服」或「判定：未说服」。',
  ]
    .filter(Boolean)
    .join('\n');
  try {
    const data = await postJson<{ answer?: string; source_type?: string }>(
      '/api/chat',
      { question, chat_history: [], document_id: args.documentId },
      FEYNMAN_TIMEOUT_MS,
    );
    const text = (data.answer || '').trim();
    const match = text.match(VERDICT_LINE);
    const reply = text.replace(VERDICT_LINE, '').replace(/[「」\s]+$/, '').trim();
    const source = data.source_type === 'RAG' ? 'document' : data.source_type === 'WEB' ? 'web' : 'offline';
    if (match && reply) return { persuaded: match[1] === '已说服', reply, source };
    if (reply) {
      const local = localFeynmanVerdict(trialBoss(args), args.answer);
      return { persuaded: local.resonance >= 60, reply, source };
    }
  } catch {
    // 后端不可用时落到本地估算
  }
  const local = localFeynmanVerdict(trialBoss(args), args.answer);
  return {
    persuaded: local.resonance >= 60,
    reply: local.resonance >= 60 ? '……你拆掉了我的立论。这颗星球认你为主。' : `还差一口气。${local.followUp}`,
    source: 'offline',
  };
}

function trialBoss(args: { guardian: string; claims: string[]; truths: string[] }): FeynmanBoss {
  return {
    guardianName: args.guardian,
    challengePrompt: args.claims.join('；'),
    keyPoints: args.truths,
    followUpHint: `「${args.claims[0]}」到底错在哪？`,
    referenceExplanation: args.truths.join('；'),
  };
}

export async function judgeFeynman(zone: KnowledgeZone, answer: string): Promise<FeynmanVerdict> {
  const boss = zone.feynmanBoss;
  try {
    return await postJson<FeynmanVerdict>(
      '/api/zones/feynman',
      {
        title: zone.zoneTitle || zone.title,
        guardian_name: boss.guardianName,
        challenge_prompt: boss.challengePrompt,
        key_points: boss.keyPoints,
        reference_explanation: boss.referenceExplanation,
        answer,
      },
      FEYNMAN_TIMEOUT_MS,
    );
  } catch {
    return localFeynmanVerdict(boss, answer);
  }
}
