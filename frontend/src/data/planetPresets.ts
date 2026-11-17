import { THEME_PALETTES, type ThemeCategory, type ThemePalette } from '../cosmos/planetIdentity';
import { PRESET_PLANETS, getPresetPlanet, type PresetPlanetSpec } from '../cosmos/presetPlanets';
import type { KnowledgeZone } from '../components/explore/zones';

export { THEME_PALETTES, PRESET_PLANETS, getPresetPlanet };
export type { ThemeCategory, ThemePalette, KnowledgeZone, PresetPlanetSpec };

/** 一颗文档星球的完整身份：兼容后端 catalog 记录与 localStorage 存档。 */
export interface PlanetRecord {
  id: string;
  /** 科幻诗意星球名，如「矩心·自注意力界」 */
  planetName: string;
  themePalette: ThemePalette;
  /** 原 PDF 文件名 */
  fileName: string;
  themeSummary: string;
  /** 0~100 总体学习进度 */
  progress: number;
  zones: KnowledgeZone[];
  pages?: number;
  isPreset?: boolean;
}

export interface MonolithNote {
  title: string;
  note: string;
}

/** 两颗旗舰示范星的 3 条核心知识星碑笔记。 */
export const PRESET_MONOLITHS: Record<string, MonolithNote[]> = {
  'preset-transformer': [
    {
      title: '星碑 I · 全局直连',
      note: '自注意力让任意两个词元一步对话（路径长度 O(1)），摆脱 RNN 的串行枷锁，训练得以整段并行。',
    },
    {
      title: '星碑 II · √d_k 缩放',
      note: 'softmax(QKᵀ/√d_k)V：维度越高点积方差越大，除以 √d_k 防止 Softmax 饱和、梯度消失。',
    },
    {
      title: '星碑 III · 多头与位置',
      note: '多头在不同子空间并行观察语法与指代；正弦位置编码为无序集合刻上可线性推算的相对距离。',
    },
  ],
  'preset-thermodynamics': [
    {
      title: '星碑 I · 卡诺极限',
      note: '任何热机效率都不超过 1 − T_C/T_H，温差才是做功的通行证，与工质种类无关。',
    },
    {
      title: '星碑 II · 熵增时间箭',
      note: '孤立系统 ΔS ≥ 0；局部可以变有序，代价是向环境排出更多熵，宇宙总账只增不减。',
    },
    {
      title: '星碑 III · 信息即物理',
      note: 'S = k_B ln Ω；兰道尔原理：擦除 1 bit 至少放热 k_B T ln 2，麦克斯韦妖因此无法击败第二定律。',
    },
  ],
};

export function isPresetId(id?: string | null): boolean {
  return Boolean(id && id.startsWith('preset-'));
}

/** 预置星在星图里的文档条目；进度默认 100，可被用户本地存档覆盖。 */
export function presetRecords(): PlanetRecord[] {
  return PRESET_PLANETS.map((spec) => ({
    id: spec.id,
    planetName: spec.planetName,
    themePalette: spec.themePalette,
    fileName: spec.fileName,
    themeSummary: spec.themeSummary,
    progress: 100,
    zones: spec.zones,
    pages: spec.pages,
    isPreset: true,
  }));
}

/** 鉴赏室星碑：预置星用固定 3 条；用户星取已完成区域的 monolithNote 前 3 条。 */
export function monolithsFor(id: string, zones: KnowledgeZone[] = []): MonolithNote[] {
  const preset = PRESET_MONOLITHS[id];
  if (preset) return preset;
  return zones
    .filter((z) => z.status === 'completed')
    .slice(0, 3)
    .map((z, i) => ({
      title: `星碑 ${['I', 'II', 'III'][i]} · ${z.zoneTitle || z.title}`,
      note: z.monolithNote || z.feynmanBoss.referenceExplanation || z.zoneIntro,
    }));
}
