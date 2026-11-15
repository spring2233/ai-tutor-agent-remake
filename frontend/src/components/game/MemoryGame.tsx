import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, RotateCcw } from 'lucide-react';

const CURRENT_DOCUMENT_KEY = 'ai-tutor-current-document-v2';
const CURRENT_DOCUMENT_NAME_KEY = 'ai-tutor-current-document-name-v2';

interface Pair {
  term: string;
  definition: string;
}

interface Card {
  key: string;
  pairIndex: number;
  text: string;
  kind: 'term' | 'definition';
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [next[index], next[swap]] = [next[swap], next[index]];
  }
  return next;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

export const MemoryGame = () => {
  const [params] = useSearchParams();
  const documentId = params.get('document') || localStorage.getItem(CURRENT_DOCUMENT_KEY);
  const [documentName, setDocumentName] = useState(
    () => localStorage.getItem(CURRENT_DOCUMENT_NAME_KEY) || ''
  );
  const [pairCount, setPairCount] = useState(6);
  const [cards, setCards] = useState<Card[]>([]);
  const [faceUp, setFaceUp] = useState<string[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [locked, setLocked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!documentId) {
      return;
    }
    fetch('/api/documents')
      .then((res) => res.json())
      .then((data) => {
        const match = (data.documents || []).find(
          (item: { id: string; name: string }) => item.id === documentId
        );
        if (match?.name) {
          setDocumentName(match.name);
        }
      })
      .catch(() => undefined);
  }, [documentId]);

  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = window.setInterval(() => {
      setSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const won = cards.length > 0 && matched.length === cards.length / 2;

  useEffect(() => {
    if (won) {
      setRunning(false);
    }
  }, [won]);

  const deal = (pairs: Pair[]) => {
    const nextCards = shuffle(
      pairs.flatMap((pair, pairIndex) => [
        {
          key: `${pairIndex}-term`,
          pairIndex,
          text: pair.term,
          kind: 'term' as const,
        },
        {
          key: `${pairIndex}-definition`,
          pairIndex,
          text: pair.definition,
          kind: 'definition' as const,
        },
      ])
    );
    setCards(nextCards);
    setFaceUp([]);
    setMatched([]);
    setMoves(0);
    setSeconds(0);
    setRunning(false);
    setLocked(false);
  };

  const startGame = async () => {
    if (!documentId) {
      return;
    }
    setIsLoading(true);
    setError('');
    setCards([]);
    try {
      const res = await fetch('/api/games/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: documentId, pair_count: pairCount }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || '无法根据这份 PDF 生成游戏');
      }
      deal(data.pairs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法根据这份 PDF 生成游戏');
    } finally {
      setIsLoading(false);
    }
  };

  const flipCard = (card: Card) => {
    if (locked || won || matched.includes(card.pairIndex) || faceUp.includes(card.key)) {
      return;
    }
    if (!running) {
      setRunning(true);
    }

    const nextFace = [...faceUp, card.key];
    setFaceUp(nextFace);
    if (nextFace.length < 2) {
      return;
    }

    setMoves((value) => value + 1);
    const [firstKey, secondKey] = nextFace;
    const first = cards.find((item) => item.key === firstKey);
    const second = cards.find((item) => item.key === secondKey);
    if (first && second && first.pairIndex === second.pairIndex) {
      setMatched((current) => [...current, first.pairIndex]);
      setFaceUp([]);
      return;
    }

    setLocked(true);
    window.setTimeout(() => {
      setFaceUp([]);
      setLocked(false);
    }, 800);
  };

  const status = useMemo(() => {
    if (!documentId) {
      return '先在书架上选一本书，再开始游戏。';
    }
    if (won) {
      return `用 ${moves} 步、${formatTime(seconds)} 配完了所有卡片。`;
    }
    return documentName ? `词条来自 ${documentName}` : '词条来自当前 PDF';
  }, [documentId, documentName, moves, seconds, won]);

  return (
    <div className="memory-page">
      <div className="hero">
        <div className="eyebrow">记忆配对</div>
        <h1>
          翻开、配对、<span className="grad-text">锁定轨道</span>
        </h1>
        <p>{status}</p>
      </div>

      {!documentId ? (
        <Link to="/?panel=library" className="btn btn-primary">
          回到书架
        </Link>
      ) : (
        <>
          <div className="memory-toolbar">
            <label>
              配对数
              <select
                className="input"
                value={pairCount}
                onChange={(event) => setPairCount(Number(event.target.value))}
                disabled={isLoading}
              >
                {[4, 6, 8].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <div className="memory-stats">
              <span>{moves} 步</span>
              <span>{formatTime(seconds)}</span>
            </div>
            <button className="btn btn-primary" type="button" onClick={startGame} disabled={isLoading}>
              {isLoading ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
              {cards.length === 0 ? '发牌' : '重新发牌'}
            </button>
          </div>

          {error && <p className="shelf-error">{error}</p>}

          {won && <div className="memory-win">全部配对完成。</div>}

          <div className="memory-grid">
            {cards.map((card) => {
              const open = faceUp.includes(card.key) || matched.includes(card.pairIndex);
              return (
                <button
                  key={card.key}
                  type="button"
                  className={`memory-card ${card.kind} ${open ? 'open' : ''} ${
                    matched.includes(card.pairIndex) ? 'matched' : ''
                  }`}
                  onClick={() => flipCard(card)}
                >
                  {open ? card.text : '?'}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
