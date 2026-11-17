import { useEffect, useRef, useState } from 'react';

/** 逐字输出；每两个字调用一次 onTick（滴答声）。reduced 时整句直接出现。 */
export function useTypewriter(text: string, { reduced = false, speed = 28, onTick }: { reduced?: boolean; speed?: number; onTick?: () => void } = {}) {
  const [shown, setShown] = useState(reduced ? text : '');
  const tickRef = useRef(onTick);
  tickRef.current = onTick;

  useEffect(() => {
    if (reduced || !text) {
      setShown(text);
      return;
    }
    setShown('');
    const chars = Array.from(text);
    let i = 0;
    const timer = window.setInterval(() => {
      i += 1;
      setShown(chars.slice(0, i).join(''));
      if (i % 2 === 0) tickRef.current?.();
      if (i >= chars.length) window.clearInterval(timer);
    }, speed);
    return () => window.clearInterval(timer);
  }, [text, reduced, speed]);

  return { shown, done: shown.length >= text.length };
}
