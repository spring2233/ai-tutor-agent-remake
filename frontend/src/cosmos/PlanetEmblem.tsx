import { getPlanetStage, hashUnit, type ThemePalette } from './planetIdentity';

interface PlanetEmblemProps {
  id: string;
  palette: ThemePalette;
  progress: number;
  size?: number;
  isSelected?: boolean;
}

/**
 * 每颗文档星球的专属程序化星徽（禁止共用静态图标）：
 * 依据 docId 哈希生成独一无二的大陆纹理偏角、星环倾角，并映射 4 档进度光晕与主题色。
 */
export const PlanetEmblem = ({ id, palette, progress, size = 44, isSelected = false }: PlanetEmblemProps) => {
  const seed = hashUnit(id);
  const stage = getPlanetStage(progress, isSelected);
  const tilt = Math.round((seed - 0.5) * 48);
  const latY = 18 + Math.round(seed * 10);
  const continentShift = Math.round(seed * 16 - 8);
  const gradId = `pe-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  const ringCircumference = 2 * Math.PI * 22;
  const dashOffset = ringCircumference * (1 - Math.max(clamped, stage === 'exploring' ? 14 : 0) / 100);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        opacity: stage === 'unexplored' ? 0.58 : 1,
        filter:
          stage === 'completed'
            ? `drop-shadow(0 0 10px ${palette.corona})`
            : stage === 'unexplored'
              ? 'none'
              : `drop-shadow(0 0 6px ${palette.primary}66)`,
      }}
    >
      <defs>
        <radialGradient id={`${gradId}-body`} cx="36%" cy="32%" r="68%">
          <stop offset="0%" stopColor={stage === 'unexplored' ? palette.surfaceB : palette.primary} />
          <stop offset="58%" stopColor={palette.surfaceB} />
          <stop offset="100%" stopColor={palette.dark} />
        </radialGradient>
        <clipPath id={`${gradId}-clip`}>
          <circle cx="28" cy="28" r="15.5" />
        </clipPath>
      </defs>

      {/* Stage 4: 100% 奶油金日冕光环 */}
      {stage === 'completed' && (
        <>
          <circle cx="28" cy="28" r="25" fill={palette.corona} fillOpacity="0.16" />
          <circle cx="28" cy="28" r="22.5" stroke="#f5efe2" strokeOpacity="0.85" strokeWidth="1.2" />
          <ellipse
            cx="28"
            cy="28"
            rx="26"
            ry="8.5"
            transform={`rotate(${tilt} 28 28)`}
            stroke="#f4c97a"
            strokeWidth="1.35"
            strokeOpacity="0.9"
          />
        </>
      )}

      {/* Stage 1: 未探索外圈暗淡虚线 */}
      {stage === 'unexplored' && (
        <circle
          cx="28"
          cy="28"
          r="22"
          stroke={palette.rim}
          strokeOpacity="0.28"
          strokeWidth="1"
          strokeDasharray="3 3.5"
        />
      )}

      {/* Stage 2 / 3: 动态青金色进度环 */}
      {(stage === 'exploring' || stage === 'partial') && (
        <>
          <circle cx="28" cy="28" r="22" stroke={palette.rim} strokeOpacity="0.15" strokeWidth="1.4" />
          <circle
            cx="28"
            cy="28"
            r="22"
            stroke={stage === 'partial' ? palette.accent : '#7ee0d6'}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeDasharray={ringCircumference}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 28 28)"
          />
        </>
      )}

      {/* 星球本体与程序化大陆纹路 */}
      <g clipPath={`url(#${gradId}-clip)`}>
        <circle cx="28" cy="28" r="15.5" fill={`url(#${gradId}-body)`} />
        <path
          d={`M${10 + continentShift} ${latY} Q 26 ${latY - 7}, 46 ${latY + 3} T 48 ${latY + 14} L 10 46 Z`}
          fill={palette.primary}
          fillOpacity={stage === 'unexplored' ? 0.14 : stage === 'completed' ? 0.55 : 0.36}
        />
        {(stage === 'partial' || stage === 'completed') && (
          <path
            d={`M14 ${34 - Math.round(seed * 6)} Q 28 ${24 + continentShift * 0.4}, 42 ${32 + Math.round(seed * 4)}`}
            stroke={stage === 'completed' ? '#f5efe2' : palette.accent}
            strokeWidth="1.2"
            strokeDasharray="2 2"
            strokeOpacity="0.85"
          />
        )}
      </g>

      {/* 菲涅尔边缘光圈 */}
      <circle
        cx="28"
        cy="28"
        r="15.5"
        stroke={stage === 'completed' ? '#fff3d6' : palette.rim}
        strokeOpacity={stage === 'unexplored' ? 0.2 : stage === 'completed' ? 0.92 : 0.55}
        strokeWidth="1.1"
      />

      {/* 探索中信标星芒 */}
      {stage === 'exploring' && (
        <circle cx="40" cy="15" r="2.6" fill="#f4c97a" stroke="#7ee0d6" strokeWidth="1" />
      )}
    </svg>
  );
};
