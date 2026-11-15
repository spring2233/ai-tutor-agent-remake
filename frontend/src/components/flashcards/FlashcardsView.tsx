import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';

export const FlashcardsView = () => {
  const [activeTab, setActiveTab] = useState<'flashcards' | 'quiz'>('flashcards');

  return (
    <div className="page-panel">
      <div className="hero">
        <div className="eyebrow">互动学习</div>
        <h1>
          用{' '}
          <span className="grad-text">闪卡与测验</span>
          掌握任何主题
        </h1>
        <p>
          生成带间隔重复的 AI 闪卡，或用互动测验检验掌握程度。
        </p>
      </div>

      <div className="hud-tabs">
        <button
          className={`btn ${activeTab === 'flashcards' ? 'btn-primary' : ''}`}
          onClick={() => setActiveTab('flashcards')}
        >
          📇 闪卡
        </button>

        <button
          className={`btn ${activeTab === 'quiz' ? 'btn-primary' : ''}`}
          onClick={() => setActiveTab('quiz')}
        >
          📝 测验
        </button>
      </div>

      {activeTab === 'flashcards' ? (
        <FlashcardsComponent />
      ) : (
        <QuizComponent />
      )}
    </div>
  );
};

// ---------------------------------------------------------
// FLASHCARDS COMPONENT
// ---------------------------------------------------------

interface Flashcard {
  front: string;
  back: string;
}

const FlashcardsComponent = () => {
  const [topic, setTopic] = useState('机器学习基础');
  const [count, setCount] = useState(5);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [flipped, setFlipped] = useState(false);

  const generateCards = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsLoading(true);
    setCards([]);
    setCurrentIdx(0);
    setFlipped(false);

    try {
      const res = await fetch('/api/flashcards', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          topic,
          count,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || '生成闪卡失败');
      }

      setCards(data.flashcards);
    } catch (err) {
      console.error(err);
      alert('生成闪卡失败');
    } finally {
      setIsLoading(false);
    }
  };

  const rateCard = async (quality: number) => {
    setFlipped(false);

    try {
      await fetch('/api/flashcards/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quality,
          previous_interval: 0,
          previous_repetitions: 0,
          previous_ease_factor: 2.5,
        }),
      });

      setCurrentIdx((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setCurrentIdx((prev) => prev + 1);
    }
  };

  if (isLoading) {
    return (
      <div
        className="card"
        style={{
          textAlign: 'center',
          padding: '3rem',
        }}
      >
        <Loader2
          className="animate-spin"
          size={32}
          style={{
            margin: '0 auto 1rem',
            color: 'var(--primary)',
          }}
        />
        <p>正在生成高质量闪卡…</p>
      </div>
    );
  }

  if (cards.length > 0 && currentIdx < cards.length) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <p
          style={{
            color: 'var(--muted)',
            marginBottom: '1rem',
          }}
        >
          第 {currentIdx + 1} 张，共 {cards.length} 张
        </p>

        <div
          style={{
            perspective: '1200px',
            width: '100%',
            maxWidth: '600px',
            height: '320px',
            cursor: 'pointer',
            marginBottom: '2rem',
          }}
          onClick={() => setFlipped(!flipped)}
        >
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              transition: 'transform 0.7s',
              transformStyle: 'preserve-3d',
              transform: flipped ? 'rotateY(180deg)' : '',
            }}
          >
            {/* Front */}
            <div
              style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                backfaceVisibility: 'hidden',
                background: 'var(--surface)',
                border: 'var(--border)',
                borderRadius: 'var(--radius)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '32px',
                textAlign: 'center',
                boxShadow: 'var(--shadow)',
              }}
            >
              <div
                style={{
                  fontSize: '2.5rem',
                  marginBottom: '16px',
                }}
              >
                ❓
              </div>

              <div
                style={{
                  fontSize: '0.74rem',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--muted)',
                  marginBottom: '12px',
                  fontWeight: 800,
                }}
              >
                问题
              </div>

              <div
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: '1.2rem',
                  fontWeight: 700,
                }}
              >
                {cards[currentIdx].front}
              </div>
            </div>

            {/* Back */}
            <div
              style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                backfaceVisibility: 'hidden',
                background: 'var(--surface-strong)',
                border: 'var(--border)',
                borderRadius: 'var(--radius)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '32px',
                textAlign: 'center',
                boxShadow: 'var(--shadow)',
                transform: 'rotateY(180deg)',
              }}
            >
              <div
                style={{
                  fontSize: '2.5rem',
                  marginBottom: '16px',
                }}
              >
                💡
              </div>

              <div
                style={{
                  fontSize: '0.74rem',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--muted)',
                  marginBottom: '12px',
                  fontWeight: 800,
                }}
              >
                答案
              </div>

              <div
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: '1.15rem',
                  fontWeight: 600,
                }}
              >
                {cards[currentIdx].back}
              </div>
            </div>
          </div>
        </div>

        {flipped && (
          <div
            style={{
              width: '100%',
              maxWidth: '600px',
              textAlign: 'center',
            }}
          >
            <p
              style={{
                color: 'var(--muted)',
                fontSize: '0.88rem',
                marginBottom: '1rem',
              }}
            >
              你对这张卡有多熟悉？
            </p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(6, 1fr)',
                gap: '8px',
              }}
            >
              <button
                className="btn"
                onClick={(e) => {
                  e.stopPropagation();
                  rateCard(0);
                }}
                title="完全不会"
              >
                😵 0
              </button>

              <button
                className="btn"
                onClick={(e) => {
                  e.stopPropagation();
                  rateCard(1);
                }}
                title="几乎不会"
              >
                😰 1
              </button>

              <button
                className="btn"
                onClick={(e) => {
                  e.stopPropagation();
                  rateCard(2);
                }}
                title="困难"
              >
                😐 2
              </button>

              <button
                className="btn"
                onClick={(e) => {
                  e.stopPropagation();
                  rateCard(3);
                }}
                title="还行"
              >
                🙂 3
              </button>

              <button
                className="btn"
                onClick={(e) => {
                  e.stopPropagation();
                  rateCard(4);
                }}
                title="良好"
              >
                😊 4
              </button>

              <button
                className="btn"
                onClick={(e) => {
                  e.stopPropagation();
                  rateCard(5);
                }}
                title="完美"
              >
                🤩 5
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (cards.length > 0 && currentIdx >= cards.length) {
    return (
      <div
        className="card"
        style={{
          textAlign: 'center',
          padding: '3rem',
        }}
      >
        <div
          style={{
            fontSize: '3rem',
            marginBottom: '1rem',
          }}
        >
          🎉
        </div>

        <h2>全部复习完成！</h2>

        <p
          style={{
            color: 'var(--muted)',
            marginBottom: '2rem',
          }}
        >
          做得好。可以再生成一批，或重新看这一组。
        </p>

        <button
          className="btn btn-primary"
          onClick={() => {
            setCards([]);
            setCurrentIdx(0);
          }}
        >
          重新开始
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="mb-4">🛠️ 生成新闪卡</h3>

      <form
        onSubmit={generateCards}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <div>
          <label
            style={{
              display: 'block',
              marginBottom: '0.5rem',
              color: 'var(--muted)',
            }}
          >
            主题
          </label>

          <input
            className="input"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>

        <div>
          <label
            style={{
              display: 'block',
              marginBottom: '0.5rem',
              color: 'var(--muted)',
            }}
          >
            卡片数量
          </label>

          <input
            type="number"
            min="1"
            max="20"
            className="input"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          style={{
            marginTop: '1rem',
          }}
        >
          生成闪卡
        </button>
      </form>
    </div>
  );
};

// ---------------------------------------------------------
// QUIZ COMPONENT
// ---------------------------------------------------------

interface QuizItem {
  q: string;
  options: string[];
  answer: string;
  why: string;
}

const QuizComponent = () => {
  const [topic, setTopic] = useState('计算机网络');
  const [difficulty, setDifficulty] = useState('Medium');
  const [count, setCount] = useState(5);

  const [items, setItems] = useState<QuizItem[]>([]);
  const [selectedAnswers, setSelectedAnswers] = useState<
    Record<number, string>
  >({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const generateQuiz = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsLoading(true);
    setItems([]);
    setSelectedAnswers({});
    setIsSubmitted(false);

    try {
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          topic,
          difficulty,
          count,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || '生成测验失败');
      }

      setItems(data.quiz);
    } catch (err) {
      console.error(err);
      alert('生成测验失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelect = (idx: number, opt: string) => {
    if (isSubmitted) return;

    setSelectedAnswers((prev) => ({
      ...prev,
      [idx]: opt,
    }));
  };

  const submitQuiz = () => {
    if (Object.keys(selectedAnswers).length < items.length) {
      alert('请先答完所有题目再提交。');
      return;
    }

    // -----------------------------------------------------
    // QUIZ TRACKING
    // -----------------------------------------------------
    const currentCount = Number(
      localStorage.getItem('ai-tutor-quizzes-taken') || '0'
    );

    localStorage.setItem(
      'ai-tutor-quizzes-taken',
      String(currentCount + 1)
    );

    setIsSubmitted(true);
  };

  if (isLoading) {
    return (
      <div
        className="card"
        style={{
          textAlign: 'center',
          padding: '3rem',
        }}
      >
        <Loader2
          className="animate-spin"
          size={32}
          style={{
            margin: '0 auto 1rem',
            color: 'var(--primary)',
          }}
        />

        <p>正在出题…</p>
      </div>
    );
  }

  if (items.length > 0) {
    let score = 0;

    if (isSubmitted) {
      score = items.reduce(
        (acc, item, i) =>
          acc + (selectedAnswers[i] === item.answer ? 1 : 0),
        0
      );
    }

    return (
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '2rem',
          }}
        >
          <div>
            <h3>📝 {topic}</h3>

            <p style={{ color: 'var(--muted)' }}>
              {{ Easy: '简单', Medium: '中等', Hard: '困难' }[difficulty] || difficulty} · {items.length} 题
            </p>
          </div>

          <button
            className="btn"
            onClick={() => {
              setItems([]);
              setSelectedAnswers({});
              setIsSubmitted(false);
            }}
          >
            ← 返回设置
          </button>
        </div>

        {isSubmitted && (
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div
              className="card"
              style={{
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: '1.5rem',
                  marginBottom: '8px',
                }}
              >
                🎯
              </div>

              <div
                style={{
                  color: 'var(--muted)',
                  fontSize: '0.8rem',
                  textTransform: 'uppercase',
                }}
              >
                得分
              </div>

              <div
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 'bold',
                }}
              >
                {score}/{items.length}
              </div>
            </div>

            <div
              className="card"
              style={{
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: '1.5rem',
                  marginBottom: '8px',
                }}
              >
                📊
              </div>

              <div
                style={{
                  color: 'var(--muted)',
                  fontSize: '0.8rem',
                  textTransform: 'uppercase',
                }}
              >
                正确率
              </div>

              <div
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 'bold',
                }}
              >
                {Math.round((score / items.length) * 100)}%
              </div>
            </div>

            <div
              className="card"
              style={{
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: '1.5rem',
                  marginBottom: '8px',
                }}
              >
                🏆
              </div>

              <div
                style={{
                  color: 'var(--muted)',
                  fontSize: '0.8rem',
                  textTransform: 'uppercase',
                }}
              >
                评价
              </div>

              <div
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 'bold',
                }}
              >
                {score / items.length >= 0.7 ? '扎实' : '需复习'}
              </div>
            </div>
          </div>
        )}

        {items.map((item, idx) => (
          <div
            key={idx}
            className="mb-8"
          >
            <p
              style={{
                fontWeight: 600,
                marginBottom: '1rem',
              }}
            >
              {idx + 1}. {item.q}
            </p>

            <div className="grid grid-cols-2 gap-4">
              {item.options.map((opt, optIdx) => {
                const isSelected = selectedAnswers[idx] === opt;
                const isCorrect = isSubmitted && opt === item.answer;
                const isWrong =
                  isSubmitted &&
                  isSelected &&
                  opt !== item.answer;

                let borderColor = 'var(--border-color)';
                let bg = 'var(--surface)';

                if (isSelected) {
                  borderColor = 'var(--primary)';
                  bg = 'var(--surface-strong)';
                }

                if (isCorrect) {
                  borderColor = 'var(--primary)';
                  bg = 'var(--surface-strong)';
                }

                if (isWrong) {
                  borderColor = 'var(--danger)';
                  bg = 'var(--surface)';
                }

                return (
                  <button
                    key={optIdx}
                    className="card"
                    style={{
                      textAlign: 'left',
                      cursor: isSubmitted
                        ? 'default'
                        : 'pointer',
                      border: `var(--border-width) solid ${borderColor}`,
                      background: bg,
                      padding: '1rem',
                    }}
                    onClick={() => handleSelect(idx, opt)}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>

            {isSubmitted && (
              <div
                style={{
                  marginTop: '1rem',
                  padding: '1rem',
                  background: 'var(--surface-strong)',
                  borderRadius: 'var(--radius)',
                  border: 'var(--border)',
                  borderLeft:
                    '4px solid var(--primary-2)',
                }}
              >
                <p
                  style={{
                    color: 'var(--muted)',
                    fontSize: '0.9rem',
                  }}
                >
                  {item.why}
                </p>
              </div>
            )}
          </div>
        ))}

        {!isSubmitted && (
          <button
            className="btn btn-primary"
            style={{
              width: '100%',
              padding: '1rem',
            }}
            onClick={submitQuiz}
          >
            ✅ 提交测验
          </button>
        )}

        {isSubmitted && (
          <button
            className="btn btn-primary"
            style={{
              width: '100%',
              padding: '1rem',
              marginTop: '1rem',
            }}
            onClick={() => {
              setItems([]);
              setSelectedAnswers({});
              setIsSubmitted(false);
            }}
          >
            📝 再做一套
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="mb-4">🛠️ 测验设置</h3>

      <form
        onSubmit={generateQuiz}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                color: 'var(--muted)',
              }}
            >
              主题
            </label>

            <input
              className="input"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>

          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                color: 'var(--muted)',
              }}
            >
              难度
            </label>

            <select
              className="input"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
            >
              <option value="Easy">简单</option>
              <option value="Medium">中等</option>
              <option value="Hard">困难</option>
            </select>
          </div>
        </div>

        <div>
          <label
            style={{
              display: 'block',
              marginBottom: '0.5rem',
              color: 'var(--muted)',
            }}
          >
            题目数量：{count}
          </label>

          <input
            type="range"
            min="3"
            max="15"
            style={{
              width: '100%',
            }}
            value={count}
            onChange={(e) =>
              setCount(Number(e.target.value))
            }
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          style={{
            marginTop: '1rem',
          }}
        >
          生成测验
        </button>
      </form>
    </div>
  );
};