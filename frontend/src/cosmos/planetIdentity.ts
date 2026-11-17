export type ThemeCategory = 'ai_cs' | 'physics_math' | 'bio_med' | 'humanities';

export interface ThemePalette {
  id: ThemeCategory;
  label: string;
  /** 主发光大陆 / 主题亮色 */
  primary: string;
  /** 能量流 / 进度高亮辅色 */
  accent: string;
  /** 星球次级海洋 / 暗区基底 */
  surfaceB: string;
  /** 背光夜半球深底色 */
  dark: string;
  /** 菲涅尔边缘大气光晕色 */
  rim: string;
  /** 100% 满星日冕光辉色 */
  corona: string;
}

/**
 * 四大知识领域专属星球外观配色：
 * - AI/计算机 -> 冷青 + 鎏金
 * - 物理/数学 -> 星云紫 + 琥珀
 * - 生物/医学 -> 荧光翡翠
 * - 人文社科 -> 暖奶油 + 赤陶
 */
export const THEME_PALETTES: Record<ThemeCategory, ThemePalette> = {
  ai_cs: {
    id: 'ai_cs',
    label: 'AI·计算机 // 冷青鎏金',
    primary: '#63e6dc',
    accent: '#f4c97a',
    surfaceB: '#123a48',
    dark: '#051018',
    rim: '#c4fcf5',
    corona: '#ffe6ad',
  },
  physics_math: {
    id: 'physics_math',
    label: '物理·数学 // 星云紫琥珀',
    primary: '#a78bfa',
    accent: '#f5a648',
    surfaceB: '#2a1656',
    dark: '#090518',
    rim: '#e4d6ff',
    corona: '#ffd99e',
  },
  bio_med: {
    id: 'bio_med',
    label: '生物·医学 // 荧光翡翠',
    primary: '#4ae8a0',
    accent: '#b4ffe0',
    surfaceB: '#0c3d30',
    dark: '#04140e',
    rim: '#c8ffe6',
    corona: '#dcffec',
  },
  humanities: {
    id: 'humanities',
    label: '人文·社科 // 暖奶油赤陶',
    primary: '#f5e4ca',
    accent: '#db6d44',
    surfaceB: '#5c2617',
    dark: '#160806',
    rim: '#ffe9d4',
    corona: '#ffeed6',
  },
};

export type PlanetStage = 'unexplored' | 'exploring' | 'partial' | 'completed';

export interface PlanetIdentityMeta {
  id: string;
  planetName: string;
  fileName: string;
  themeSummary: string;
  themePalette: ThemePalette;
  progress: number;
  isPreset?: boolean;
}

interface StoredPlanetMeta {
  planetName?: string;
  themeCategory?: ThemeCategory;
  themeSummary?: string;
}

const META_STORAGE_KEY = 'cognita-planet-meta-v1';

export function hashUnit(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function readStoredMap(): Record<string, StoredPlanetMeta> {
  try {
    const raw = localStorage.getItem(META_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, StoredPlanetMeta>) : {};
  } catch {
    return {};
  }
}

export function storePlanetMeta(docId: string, meta: Partial<StoredPlanetMeta>) {
  if (!docId) return;
  try {
    const map = readStoredMap();
    const prev = map[docId] || {};
    map[docId] = {
      planetName: meta.planetName?.trim() || prev.planetName,
      themeCategory: meta.themeCategory || prev.themeCategory,
      themeSummary: meta.themeSummary?.trim() || prev.themeSummary,
    };
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
}

export function isValidThemeCategory(val?: string | null): val is ThemeCategory {
  return val === 'ai_cs' || val === 'physics_math' || val === 'bio_med' || val === 'humanities';
}

export function inferThemeCategory(blob: string, fallbackSeed: string): ThemeCategory {
  const lower = blob.toLowerCase();
  if (
    /(transformer|attention|neural|deep|learning|llm|gpt|rag|agent|algorithm|code|python|robot|sim|control|graph|database|compiler|linux|人工智能|计算机|神经网络|深度学习|算法|模型|注意力|编程|控制|向量|检索|随机化|导纳)/.test(
      lower,
    )
  ) {
    return 'ai_cs';
  }
  if (
    /(thermodynamic|entropy|carnot|quantum|qubit|physics|math|calculus|linear|algebra|matrix|probability|statistics|relativity|mechanics|optic|wave|topology|theorem|热力学|熵|卡诺|量子|物理|数学|微积分|矩阵|线性代数|概率|统计|力学|几何|方程|拓扑)/.test(
      lower,
    )
  ) {
    return 'physics_math';
  }
  if (
    /(bio|cell|gene|genome|dna|rna|protein|med|clinical|neuro|brain|ecology|evolution|immune|virus|chemistry|molecule|生物|医学|细胞|基因|蛋白|临床|神经|生态|进化|免疫|化学|分子|药理)/.test(
      lower,
    )
  ) {
    return 'bio_med';
  }
  if (
    /(history|philosophy|literature|art|society|sociology|psychology|econ|finance|law|culture|politics|education|design|历史|哲学|文学|艺术|社会|心理|经济|金融|法律|文化|人文|政治|教育|叙事)/.test(
      lower,
    )
  ) {
    return 'humanities';
  }
  const cats: ThemeCategory[] = ['ai_cs', 'physics_math', 'bio_med', 'humanities'];
  const idx = Math.floor(hashUnit(fallbackSeed) * cats.length) % cats.length;
  return cats[idx];
}

const DOMAIN_PREFIXES: Record<ThemeCategory, string[]> = {
  ai_cs: ['矩心', '潜维', '星枢', '张量', '脉冲', '神经'],
  physics_math: ['卡诺', '黎曼', '奇点', '相干', '希尔伯特', '测地'],
  bio_med: ['生息', '双螺旋', '突触', '叶绿', '胞质', '荧光'],
  humanities: ['思辨', '赤陶', '叙事', '纪年', '回响', '雅典'],
};

const DOMAIN_SUFFIXES: Record<ThemeCategory, string[]> = {
  ai_cs: ['星界', '流形海', '脉冲原', '矩阵环', '拓扑界'],
  physics_math: ['荒原', '测地界', '相空间', '星渊', '引力环'],
  bio_med: ['翡翠海', '生息林', '珊瑚界', '脉动原', '孢子云'],
  humanities: ['回响谷', '纪年原', '赤陶岸', '思辨界', '书简海'],
};

function cleanStem(fileName: string): string {
  const bare = fileName
    .replace(/\.pdf$/i, '')
    .replace(/^\d{4}\.\d{4,5}(v\d+)?[\s_-]*/i, '')
    .replace(/^[\d._-]+/, '')
    .trim();
  if (!bare) return '未知星域';

  const cjk = bare.match(/[\u4e00-\u9fff]{2,6}/);
  if (cjk) return cjk[0];

  const words = bare
    .split(/[_\-\s:：()（）[\]]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !/^(pdf|doc|paper|final|v\d+|report|chapter|lecture|notes)$/i.test(w));

  if (words.length > 0) {
    const pick = words[0];
    if (pick.length <= 7) {
      return pick.charAt(0).toUpperCase() + pick.slice(1).toLowerCase();
    }
    return pick.slice(0, 6).toUpperCase();
  }
  return bare.slice(0, 5);
}

export function synthesizePlanetName(
  docId: string,
  fileName: string,
  category: ThemeCategory,
  hintText = '',
): string {
  const blob = `${fileName} ${hintText}`.toLowerCase();
  if (/transformer|attention\s+is\s+all|自注意力/.test(blob)) {
    return '「矩心·自注意力界」';
  }
  if (/thermodynamic|entropy|carnot|热力学|熵增/.test(blob)) {
    return '「卡诺·熵增荒原」';
  }
  if (/domain\s*randomization|sim.*real|领域随机化/.test(blob)) {
    return '「拟真·域迁星原」';
  }
  if (/admittance|impedance|导纳|力控/.test(blob)) {
    return '「导纳·力控星环」';
  }
  if (/quantum|qubit|量子/.test(blob)) {
    return '「叠态·相干星渊」';
  }

  const h1 = hashUnit(`${docId}:${fileName}:p`);
  const h2 = hashUnit(`${docId}:${fileName}:s`);
  const prefixes = DOMAIN_PREFIXES[category];
  const suffixes = DOMAIN_SUFFIXES[category];
  const prefix = prefixes[Math.floor(h1 * prefixes.length) % prefixes.length];
  const suffix = suffixes[Math.floor(h2 * suffixes.length) % suffixes.length];
  const stem = cleanStem(fileName);

  // 若提取到短中文词根，直接嵌入诗意后缀；若为英文缩写，拼合星界后缀
  if (/^[\u4e00-\u9fff]+$/.test(stem) && stem.length <= 4) {
    return `「${prefix}·${stem}${suffix.slice(-1)}」`;
  }
  return `「${prefix}·${stem}界」`;
}

function wrapBrackets(name: string): string {
  const trimmed = name.trim().replace(/^[「『\[]+|[」』\]]+$/g, '');
  return `「${trimmed}」`;
}

/**
 * 为单颗星球生成 slight 确定性色偏，保证即便同领域两份 PDF 也有细微独特色调，绝不千篇一律。
 */
export function personalizePalette(base: ThemePalette, seedKey: string): ThemePalette {
  const seed = hashUnit(seedKey);
  if (seedKey.startsWith('preset-')) return base;
  // 保持四大主题的主辨识度，同时按 seed 微调亮色冷暖 6%
  const shift = (hex: string, delta: number) => {
    const clean = hex.replace('#', '');
    const num = parseInt(clean, 16);
    const r = Math.min(255, Math.max(0, ((num >> 16) & 255) + delta));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 255) + Math.round(delta * 0.4)));
    const b = Math.min(255, Math.max(0, (num & 255) - Math.round(delta * 0.5)));
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  };
  const offset = Math.round((seed - 0.5) * 22);
  return {
    ...base,
    primary: shift(base.primary, offset),
    accent: shift(base.accent, -offset),
  };
}

export function resolvePlanetIdentity(input: {
  id: string;
  fileName: string;
  planetName?: string;
  themeCategory?: string;
  themeSummary?: string;
  zoneHints?: string[];
  progress?: number;
  isPreset?: boolean;
}): PlanetIdentityMeta {
  const stored = readStoredMap()[input.id] || {};
  const fileName = input.fileName || input.id;
  const hintBlob = (input.zoneHints || []).join(' ');

  const rawCat = input.themeCategory || stored.themeCategory;
  const category: ThemeCategory = isValidThemeCategory(rawCat)
    ? rawCat
    : inferThemeCategory(`${fileName} ${hintBlob}`, `${input.id}:${fileName}`);

  const basePalette = THEME_PALETTES[category];
  const themePalette = input.isPreset ? basePalette : personalizePalette(basePalette, `${input.id}:${fileName}`);

  const rawPlanetName = input.planetName || stored.planetName;
  const planetName = rawPlanetName
    ? wrapBrackets(rawPlanetName)
    : synthesizePlanetName(input.id, fileName, category, hintBlob);

  const bareTitle = fileName.replace(/\.pdf$/i, '').trim() || '未命名文献';
  const rawSummary = input.themeSummary || stored.themeSummary;
  const themeSummary =
    rawSummary ||
    (input.zoneHints && input.zoneHints.length > 0
      ? input.zoneHints.slice(0, 2).join('；')
      : `源自《${bareTitle.slice(0, 32)}》的专属知识星界，探索地表信标以点亮章节脉络。`);

  const progress = Math.max(0, Math.min(100, Math.round(input.progress ?? 0)));

  return {
    id: input.id,
    planetName,
    fileName,
    themeSummary,
    themePalette,
    progress,
    isPreset: input.isPreset,
  };
}

/**
 * 4 档进度视觉状态判定：
 * 1. unexplored: progress === 0 且未选中
 * 2. exploring:  0 < progress < 30 或当前选中
 * 3. partial:    30 <= progress < 100
 * 4. completed:  progress === 100
 */
export function getPlanetStage(progress: number, isSelected = false): PlanetStage {
  const p = Math.max(0, Math.min(100, Math.round(progress)));
  if (p >= 100) return 'completed';
  if (p >= 30) return 'partial';
  if (p > 0 || isSelected) return 'exploring';
  return 'unexplored';
}

export function formatPlanetBadge(progress: number, isSelected = false): string {
  const p = Math.max(0, Math.min(100, Math.round(progress)));
  const stage = getPlanetStage(p, isSelected);
  if (stage === 'completed') return '✦ 全部完成 · 100%';
  if (stage === 'partial') return `部分完成 · ${p}%`;
  if (stage === 'exploring') return p > 0 ? `探索中 · ${p}%` : '探索中 · 已锁定';
  return '[未探索]';
}
