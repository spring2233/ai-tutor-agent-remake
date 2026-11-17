import { useEffect, useMemo, useState, type CSSProperties } from 'react';

const MASCOT_SRC = '/mascot.png';
const REACTION_MS = 800;
const BUBBLE_MS = 1500;

export interface CompanionReaction {
  kind: 'cheer' | 'wobble';
  /** 每次反应换一个 key，相同动画才能重播。 */
  key: number;
  bubble?: string;
}

interface Props {
  /** 星球探索进度 0~100：越高悬浮呼吸越大、身边星光越多。 */
  progress: number;
  reaction?: CompanionReaction | null;
  reduced: boolean;
  className?: string;
}

/** 星界全息伴侣：左下角的 2.5D 领航员，带青金色全息底座，随探索进度进化并对穿门结果做出反应。 */
export const HoloCompanion = ({ progress, reaction, reduced, className = '' }: Props) => {
  const [missing, setMissing] = useState(false);
  const [mood, setMood] = useState<CompanionReaction | null>(null);
  const [bubble, setBubble] = useState<{ key: number; text: string } | null>(null);
  const p = Math.max(0, Math.min(100, progress));

  useEffect(() => {
    if (!reaction) return;
    setMood(reaction);
    const moodTimer = window.setTimeout(() => setMood((m) => (m?.key === reaction.key ? null : m)), REACTION_MS);
    let bubbleTimer = 0;
    if (reaction.bubble) {
      setBubble({ key: reaction.key, text: reaction.bubble });
      bubbleTimer = window.setTimeout(() => setBubble((b) => (b?.key === reaction.key ? null : b)), BUBBLE_MS);
    }
    return () => {
      window.clearTimeout(moodTimer);
      window.clearTimeout(bubbleTimer);
    };
  }, [reaction]);

  const sparks = useMemo(() => {
    const count = 3 + Math.round((p / 100) * 9);
    return Array.from({ length: count }, (_, i) => {
      const angle = (i * 137.5 * Math.PI) / 180;
      const radius = 34 + (i % 4) * 11;
      return {
        left: `${50 + Math.cos(angle) * radius}%`,
        top: `${46 + Math.sin(angle) * radius * 0.8}%`,
        delay: `${(i * 0.37) % 2.4}s`,
        size: `${3 + (i % 3)}px`,
      };
    });
  }, [p]);

  const style = {
    '--breath-amp': `${(4 + p * 0.08).toFixed(1)}px`,
    '--breath-dur': `${(3.6 - p * 0.012).toFixed(2)}s`,
    '--holo-glow': (0.35 + p * 0.004).toFixed(2),
  } as CSSProperties;

  const moodClass = mood ? ` ${mood.kind}` : '';

  return (
    <div className={`holo-companion${reduced ? ' reduced' : ''} ${className}`} style={style} aria-hidden="true">
      {bubble ? (
        <span className="holo-bubble" key={bubble.key}>
          {bubble.text}
        </span>
      ) : null}
      <div className="holo-sparks">
        {sparks.map((s, i) => (
          <i key={i} style={{ left: s.left, top: s.top, width: s.size, height: s.size, animationDelay: s.delay }} />
        ))}
      </div>
      <div className="holo-float">
        <div className={`holo-body${moodClass}`} key={mood?.key ?? 'idle'}>
          {missing ? (
            <span className="holo-fallback">✦</span>
          ) : (
            <img src={MASCOT_SRC} alt="" draggable={false} onError={() => setMissing(true)} />
          )}
        </div>
      </div>
      <div className="holo-base" />
    </div>
  );
};
