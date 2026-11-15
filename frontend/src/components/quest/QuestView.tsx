import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, Swords } from 'lucide-react';
import './quest.css';

const CURRENT_DOCUMENT_KEY = 'ai-tutor-current-document-v2';
const CURRENT_DOCUMENT_NAME_KEY = 'ai-tutor-current-document-name-v2';
const HERO_KEY = 'ai-tutor-hero';

type Genre = 'research' | 'teaching' | 'exam';
type Hero = 'male' | 'female';

interface Question {
  q: string;
  options: string[];
  answer: string;
  why: string;
}

interface QuestTask extends Question {
  id: string;
  concept: string;
}

interface QuestArea {
  id: string;
  title: string;
  summary: string;
  tasks: QuestTask[];
}

interface Quest {
  title: string;
  genre: Genre;
  areas: QuestArea[];
  boss: Question[];
}

interface Progress {
  clearedTaskIds: string[];
  bossHits: number;
  bossCleared: boolean;
}

const GENRE_LABEL: Record<Genre, string> = {
  research: '科研',
  teaching: '教学',
  exam: '试题',
};

const emptyProgress = (): Progress => ({
  clearedTaskIds: [],
  bossHits: 0,
  bossCleared: false,
});

function questKey(documentId: string) {
  return `ai-tutor-quest-v2:${documentId}`;
}

function progressKey(documentId: string) {
  return `ai-tutor-quest-progress-v1:${documentId}`;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

export const QuestView = () => {
  const [params] = useSearchParams();
  const documentId = params.get('document') || localStorage.getItem(CURRENT_DOCUMENT_KEY);
  const [documentName, setDocumentName] = useState(
    () => localStorage.getItem(CURRENT_DOCUMENT_NAME_KEY) || '已选 PDF'
  );
  const [hero, setHero] = useState<Hero | null>(() => {
    const saved = localStorage.getItem(HERO_KEY);
    return saved === 'male' || saved === 'female' ? saved : null;
  });
  const [quest, setQuest] = useState<Quest | null>(null);
  const [progress, setProgress] = useState<Progress>(emptyProgress);
  const [activeTask, setActiveTask] = useState<QuestTask | null>(null);
  const [feedback, setFeedback] = useState('');
  const [bossOpen, setBossOpen] = useState(false);
  const [bossIndex, setBossIndex] = useState(0);
  const [bossHits, setBossHits] = useState(0);
  const [bossNote, setBossNote] = useState('');
  const [bossShake, setBossShake] = useState(false);
  const [attackFrame, setAttackFrame] = useState<number | null>(null);
  const attackTimer = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!documentId) {
      return;
    }
    setQuest(readJson<Quest>(questKey(documentId)));
    setProgress(readJson<Progress>(progressKey(documentId)) || emptyProgress());
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

  const saveProgress = (next: Progress) => {
    setProgress(next);
    if (documentId) {
      localStorage.setItem(progressKey(documentId), JSON.stringify(next));
    }
  };

  const generate = async () => {
    if (!documentId) {
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/quests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: documentId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || '无法生成这条任务线');
      }
      setQuest(data.quest);
      localStorage.setItem(questKey(documentId), JSON.stringify(data.quest));
      saveProgress(emptyProgress());
      setBossOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法生成这条任务线');
    } finally {
      setLoading(false);
    }
  };

  const cleared = useMemo(() => new Set(progress.clearedTaskIds), [progress.clearedTaskIds]);
  const areaOpen = (index: number) => {
    if (!quest || index === 0) {
      return true;
    }
    return quest.areas[index - 1].tasks.every((task) => cleared.has(task.id));
  };
  const allTasksCleared = !!quest && quest.areas.every((area) => area.tasks.every((task) => cleared.has(task.id)));

  const answerTask = (option: string) => {
    if (!activeTask) {
      return;
    }
    if (option !== activeTask.answer) {
      setFeedback(activeTask.why);
      return;
    }
    const next = {
      ...progress,
      clearedTaskIds: progress.clearedTaskIds.includes(activeTask.id)
        ? progress.clearedTaskIds
        : [...progress.clearedTaskIds, activeTask.id],
    };
    saveProgress(next);
    setActiveTask(null);
    setFeedback('');
  };

  const startBoss = () => {
    setBossOpen(true);
    setBossIndex(0);
    setBossHits(0);
    setBossNote('');
    setBossShake(false);
    setAttackFrame(null);
    if (attackTimer.current) {
      window.clearInterval(attackTimer.current);
      attackTimer.current = null;
    }
  };

  const answerBoss = (option: string) => {
    if (!quest) {
      return;
    }
    const current = quest.boss[bossIndex];
    const hit = option === current.answer;
    const hits = bossHits + (hit ? 1 : 0);
    const last = bossIndex === quest.boss.length - 1;
    setBossHits(hits);
    setBossNote(hit ? '命中' : current.why);
    if (hit) {
      if (attackTimer.current) {
        window.clearInterval(attackTimer.current);
      }
      setAttackFrame(0);
      setBossShake(true);
      let frame = 0;
      attackTimer.current = window.setInterval(() => {
        frame += 1;
        if (frame >= 5) {
          if (attackTimer.current) {
            window.clearInterval(attackTimer.current);
            attackTimer.current = null;
          }
          setAttackFrame(null);
          setBossShake(false);
          return;
        }
        setAttackFrame(frame);
      }, 75);
    }
    if (!last) {
      window.setTimeout(() => {
        setBossIndex((value) => value + 1);
        setBossNote('');
      }, hit ? 500 : 900);
      return;
    }
    saveProgress({
      ...progress,
      bossHits: hits,
      bossCleared: hits >= 4,
    });
  };

  if (!documentId) {
    return (
      <div className="quest-page">
        <p>先回档案选一份 PDF，再开始探索。</p>
        <Link to="/?panel=library" className="btn btn-primary">回到档案</Link>
      </div>
    );
  }

  if (!hero) {
    return (
      <div className="quest-page quest-pick">
        <h1>选择闯关角色</h1>
        <div className="quest-heroes">
          {(['male', 'female'] as Hero[]).map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => {
                localStorage.setItem(HERO_KEY, choice);
                setHero(choice);
              }}
            >
              <img src={`/quest/${choice}.png`} alt={choice === 'male' ? '男角色' : '女角色'} />
              <span>{choice === 'male' ? '剑士' : '法师'}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!quest) {
    return (
      <div className="quest-page">
        <h1>{documentName}</h1>
        <p>把这篇 PDF 拆成一条学习任务线。</p>
        {error && <p className="shelf-error">{error}</p>}
        <button className="btn btn-primary" type="button" onClick={generate} disabled={loading}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Swords size={16} />}
          生成任务线
        </button>
      </div>
    );
  }

  const bossQuestion = quest.boss[bossIndex];
  const bossDefeated = progress.bossCleared || (bossOpen && bossIndex === quest.boss.length - 1 && bossHits >= 4 && bossNote !== '');
  const bossHp = bossDefeated ? 0 : 5 - bossHits;

  return (
    <div className={`quest-page quest-map ${quest.genre}`}>
      <header className="quest-head">
        <div>
          <p>{GENRE_LABEL[quest.genre]} · {documentName}</p>
          <h1>{quest.title}</h1>
        </div>
        <img className="quest-hero-badge" src={`/quest/${hero}.png`} alt="" />
      </header>

      <ol className="quest-path">
        {quest.areas.map((area, index) => {
          const open = areaOpen(index);
          return (
            <li key={area.id} className={open ? 'open' : 'locked'}>
              <h2>{area.title}</h2>
              <p>{area.summary}</p>
              <div className="quest-tasks">
                {area.tasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    disabled={!open || cleared.has(task.id)}
                    onClick={() => {
                      setActiveTask(task);
                      setFeedback('');
                    }}
                  >
                    {cleared.has(task.id) ? '已完成' : task.concept}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ol>

      <button className="btn btn-primary" type="button" disabled={!allTasksCleared} onClick={startBoss}>
        挑战首领
      </button>

      {activeTask && (
        <div className="quest-modal">
          <div className="quest-card">
            <p>{activeTask.concept}</p>
            <h2>{activeTask.q}</h2>
            <div className="quest-options">
              {activeTask.options.map((option) => (
                <button key={option} type="button" onClick={() => answerTask(option)}>
                  {option}
                </button>
              ))}
            </div>
            {feedback && <p className="quest-why">{feedback}</p>}
            <button type="button" className="btn" onClick={() => setActiveTask(null)}>关闭</button>
          </div>
        </div>
      )}

      {bossOpen && (
        <div className={`quest-modal quest-battle ${quest.genre}`}>
          <div className="battle-scene">
            <img className="scene-bg" src="/quest/background-fight.jpg" alt="" />
            <img
              className="scene-hero"
              src={
                attackFrame === null
                  ? `/quest/${hero}.png`
                  : `/quest/${hero}-attack-${attackFrame}.png`
              }
              alt=""
            />
            <img
              className={`scene-boss${bossShake ? ' hit' : ''}${bossDefeated ? ' defeated' : ''}`}
              src="/quest/boss.png"
              alt="首领"
            />
            <div className="boss-hp" aria-label="Boss 生命">
              {Array.from({ length: 5 }, (_, index) => (
                <span key={index} className={index < Math.max(bossHp, 0) ? 'full' : ''} />
              ))}
            </div>
          </div>
          {bossDefeated ? (
            <div className="quest-card">
              <h2>首领已被消灭</h2>
              <p>你答对了 {bossHits} / 5 题。</p>
              <button type="button" className="btn" onClick={() => setBossOpen(false)}>返回任务线</button>
            </div>
          ) : bossIndex === quest.boss.length - 1 && bossNote && bossHits < 4 ? (
            <div className="quest-card">
              <h2>首领还在</h2>
              <p>答对 {bossHits} / 5，至少需要 4 题。可以再挑战一次。</p>
              <button type="button" className="btn btn-primary" onClick={startBoss}>重新挑战</button>
            </div>
          ) : (
            <div className="quest-card">
              <p>首领 {bossIndex + 1} / 5</p>
              <h2>{bossQuestion.q}</h2>
              <div className="quest-options">
                {bossQuestion.options.map((option) => (
                  <button key={option} type="button" onClick={() => answerBoss(option)} disabled={bossNote !== ''}>
                    {option}
                  </button>
                ))}
              </div>
              {bossNote && <p className="quest-why">{bossNote}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
