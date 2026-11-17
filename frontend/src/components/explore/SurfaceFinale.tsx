import { useCallback, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { CornerDownLeft, Loader2 } from 'lucide-react';
import type { CosmosScene } from '../../cosmos/CosmosScene2';
import { ResonanceTether } from './ResonanceTether';
import { useTypewriter } from './useTypewriter';
import {
  askGuardianTrial,
  grantMasterBadge,
  hasMasterBadge,
  isCollected,
  markCollected,
  type KnowledgeZone,
  type TrialVerdict,
  type TwinGate,
} from './zones';

const SOURCE_LABEL: Record<TrialVerdict['source'], string> = {
  document: '依据：上传文档',
  web: 'Web result · 依据网页搜索，非文档原文',
  offline: '守门人离线估算',
};

interface Props {
  scene: CosmosScene;
  documentId: string;
  planetName: string;
  zones: KnowledgeZone[];
  gateSets: TwinGate[][];
  reduced: boolean;
}

/** 100% 同步率结算全息舱：收录进鉴赏室（主）或挑战费曼终极试炼（可选）。 */
export const SurfaceFinale = ({ scene, documentId, planetName, zones, gateSets, reduced }: Props) => {
  const [collected, setCollected] = useState(() => isCollected(documentId));
  const [touring, setTouring] = useState(false);
  const [trial, setTrial] = useState(false);
  const [master, setMaster] = useState(() => hasMasterBadge(documentId));

  const collect = () => {
    markCollected(documentId);
    setCollected(true);
  };

  const tour = () => {
    if (!collected) collect();
    scene.startSurfaceTour();
    setTouring(true);
    setTrial(false);
  };

  if (touring) {
    return (
      <div className="surface-panel surface-panel-mini">
        <span>纯享漫游中 · {planetName}</span>
        {master ? <span className="master-badge">✦ 星界大师</span> : null}
        <Link to="/gallery" className="pill hud-pill">前往星界鉴赏室</Link>
      </div>
    );
  }

  return (
    <div className={`surface-panel${trial ? ' wide' : ''}`} role="dialog" aria-label="星球结算">
      <p className="surface-panel-kicker">SYNC 100% · 星球生态已完全复苏</p>
      <h2>{planetName}</h2>
      {master ? <p className="master-badge">✦ 星界大师 · 金色徽章已解锁</p> : null}

      {trial ? (
        <FeynmanTrial
          scene={scene}
          documentId={documentId}
          planetName={planetName}
          zones={zones}
          gateSets={gateSets}
          reduced={reduced}
          onWin={() => {
            grantMasterBadge(documentId);
            setMaster(true);
          }}
          onBack={() => setTrial(false)}
        />
      ) : (
        <div className="surface-choices">
          {collected ? (
            <>
              <p className="surface-collected">已收录进星界鉴赏室 · +100 星能</p>
              <button type="button" className="btn btn-primary" onClick={tour}>
                切入纯享漫游
              </button>
              <Link to="/gallery" className="btn">
                前往星界鉴赏室
              </Link>
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={collect}>
              收录进星界鉴赏室
            </button>
          )}
          <button type="button" className="btn surface-boss-btn" onClick={() => setTrial(true)}>
            ⚔️ 挑战区域守门人 · 费曼终极试炼（双倍能量）
          </button>
        </div>
      )}
    </div>
  );
};

// ----------------------------------------------------------------------------
// 费曼终极试炼：守门人立论两条误区，学员用自己的话反驳，走 /api/chat
// ----------------------------------------------------------------------------

interface TrialProps {
  scene: CosmosScene;
  documentId: string;
  planetName: string;
  zones: KnowledgeZone[];
  gateSets: TwinGate[][];
  reduced: boolean;
  onWin: () => void;
  onBack: () => void;
}

const FeynmanTrial = ({ scene, documentId, planetName, zones, gateSets, reduced, onWin, onBack }: TrialProps) => {
  const picks = useMemo(() => {
    const withGates = gateSets.map((set, i) => ({ set, i })).filter((g) => g.set.length > 0);
    const chosen = withGates.length > 2 ? [withGates[0], withGates[withGates.length - 1]] : withGates;
    return chosen.map(({ set }) => set[set.length - 1]);
  }, [gateSets]);
  const guardian = zones[zones.length - 1]?.feynmanBoss.guardianName || 'GUARDIAN // 区域守门人';
  const claims = picks.map((g) => g.trap);
  const truths = picks.map((g) => g.truth);

  const opening = `我是 ${guardian}。我坚持：${claims.map((c) => `「${c}」`).join('，而且')}。你若真懂这颗星球，就用自己的话驳倒我。`;
  const [line, setLine] = useState(opening);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [rounds, setRounds] = useState(0);
  const [won, setWon] = useState(false);
  const [source, setSource] = useState<TrialVerdict['source'] | null>(null);
  const avatarRef = useRef<HTMLDivElement>(null);
  const inputWrap = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const typingAt = useRef(0);
  const { shown, done } = useTypewriter(line, { reduced, onTick: () => scene.audio.playTick() });

  const getSource = useCallback(() => {
    const rect = avatarRef.current?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, visible: true } : null;
  }, []);

  const submit = async () => {
    const answer = draft.trim();
    if (!answer || busy || won) return;
    setBusy(true);
    const verdict = await askGuardianTrial({
      documentId,
      planetName,
      guardian,
      claims,
      truths,
      answer,
      lastReply: rounds > 0 ? line : undefined,
    });
    setBusy(false);
    setRounds((n) => n + 1);
    setSource(verdict.source);
    setLine(verdict.reply);
    if (verdict.persuaded) {
      setWon(true);
      onWin();
      scene.audio.playResonanceBoom();
    } else {
      setDraft('');
      window.setTimeout(() => textRef.current?.focus(), 0);
    }
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    typingAt.current = performance.now();
    setDraft(event.target.value);
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 150)}px`;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className={`duel trial${won ? ' tense' : ''}`}>
      <div className="duel-guardian">
        <div className="duel-avatar" ref={avatarRef}>
          <img src="/quest/boss.png" alt="" />
        </div>
        <div className="duel-id">
          <span className="duel-name">{guardian}</span>
          <span className="duel-resonance">
            费曼终极试炼 · 第 <b>{rounds + (won ? 0 : 1)}</b> 轮
            {source ? <em>{SOURCE_LABEL[source]}</em> : null}
          </span>
        </div>
      </div>

      <p className="duel-line" aria-live="polite">
        {shown}
        <span className={`duel-caret${done ? ' idle' : ''}`} />
      </p>

      {won ? (
        <div className="trial-win">
          <p className="master-badge big">✦ 星界大师</p>
          <p>守门人已被说服 · +200 星能（双倍）</p>
        </div>
      ) : null}

      <div className={`duel-input${busy ? ' busy' : ''}`} ref={inputWrap}>
        <textarea
          ref={textRef}
          rows={1}
          value={draft}
          placeholder={won ? '共鸣已满，守门人认你为主' : '用你自己的话指出守门人错在哪……  Enter 发送'}
          onChange={onChange}
          onKeyDown={onKeyDown}
          disabled={won}
          aria-label="反驳守门人"
          autoFocus
        />
        <button type="button" className="duel-send" onClick={() => void submit()} disabled={busy || won || !draft.trim()} aria-label="发送反驳">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <CornerDownLeft size={15} />}
        </button>
      </div>

      <button type="button" className="zone-rescan" onClick={onBack}>
        ← 返回结算
      </button>

      {createPortal(
        <ResonanceTether
          getSource={getSource}
          target={inputWrap}
          resonance={won ? 100 : Math.min(80, 20 + rounds * 25)}
          typingAt={typingAt}
          charging={busy}
          tense={won}
          reduced={reduced}
        />,
        document.body,
      )}
    </div>
  );
};
