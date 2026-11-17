import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { CosmosScene } from '../../cosmos/CosmosScene2';
import { codexFor, reviewCardsFor, type KnowledgeZone } from './zones';

const pad = (n: number) => String(n).padStart(2, '0');

interface Props {
  scene: CosmosScene;
  documentId: string;
  planetName: string;
  planetIntro?: string;
  zones: KnowledgeZone[];
  reduced: boolean;
}

/** 通关后的地表纯享漫游：沿途记忆星碑卡片 + 「全息星典总览」面板（M 键切换）。 */
export const TourReview = ({ scene, documentId, planetName, planetIntro, zones, reduced }: Props) => {
  const cards = useMemo(() => reviewCardsFor(documentId, zones), [documentId, zones]);
  const [open, setOpen] = useState(false);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    scene.setSurfaceMonoliths(cards.length);
    return () => scene.setSurfaceMonoliths(0);
  }, [scene, cards.length]);

  useEffect(() => {
    scene.setCallbacks({
      onMonolithAnchors: (list) => {
        const used = new Set<number>();
        list.forEach((a) => {
          const el = cardRefs.current[a.card];
          if (!el || used.has(a.card)) return;
          used.add(a.card);
          // 远处半透明微缩、靠近清晰放大；卡片朝星碑外侧展开，避开中央花海
          const scale = reduced ? 1 : 0.6 + 0.4 * a.near;
          const shiftX = a.side === 'left' ? -86 : -14;
          el.style.transformOrigin = a.side === 'left' ? '86% 100%' : '14% 100%';
          el.style.transform = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0) translate(${shiftX}%, -100%) scale(${scale.toFixed(3)})`;
          el.style.opacity = (a.weight * (0.42 + 0.58 * a.near)).toFixed(3);
          el.style.filter = reduced ? '' : `blur(${((1 - a.near) * 1.6).toFixed(2)}px)`;
        });
        cardRefs.current.forEach((el, i) => {
          if (el && !used.has(i)) el.style.opacity = '0';
        });
      },
    });
    return () => scene.setCallbacks({ onMonolithAnchors: undefined });
  }, [scene, reduced]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div className="tour-cards" aria-hidden="true">
        {cards.map((card, i) => (
          <article
            key={`${i}:${card.text}`}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            className="tour-card"
          >
            <span className="tour-card-chapter">
              ZONE {pad(card.zoneIndex + 1)} · {card.chapter}
            </span>
            <span className="tour-card-label">{card.label}</span>
            <p>{card.text}</p>
          </article>
        ))}
      </div>

      <button
        type="button"
        className={`tour-dock${open ? ' on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="tour-codex"
      >
        ◈ 全息星典总览 <kbd>M</kbd>
      </button>

      <section
        id="tour-codex"
        className={`tour-codex${open ? ' open' : ''}`}
        aria-hidden={!open}
        aria-label="全息星典总览"
      >
        <header className="tour-codex-head">
          <div>
            <p className="tour-codex-kicker">HOLO CODEX · 全息星典</p>
            <h2>{planetName}</h2>
            {planetIntro ? <p className="tour-codex-intro">{planetIntro}</p> : null}
          </div>
          <button type="button" className="tour-codex-close" onClick={() => setOpen(false)} aria-label="关闭星典总览" tabIndex={open ? 0 : -1}>
            <X size={16} />
          </button>
        </header>
        <div className="tour-codex-grid">
          {zones.map((zone, i) => {
            const rows = zone.pending ? [] : codexFor(documentId, zone);
            return (
              <section key={zone.id} className="tour-codex-zone">
                <h3>
                  <span>ZONE {pad(i + 1)}</span>
                  {zone.title}
                </h3>
                {zone.zoneIntro || zone.summary ? <p className="tour-codex-summary">{zone.zoneIntro || zone.summary}</p> : null}
                {rows.length ? (
                  <ol>
                    {rows.map((row) => (
                      <li key={row.label + row.truth}>
                        <span>{row.label}</span>
                        <b>{row.truth}</b>
                        {row.note ? <em>{row.note}</em> : null}
                      </li>
                    ))}
                  </ol>
                ) : null}
                {zone.monolithNote ? <p className="tour-codex-note">✦ {zone.monolithNote}</p> : null}
              </section>
            );
          })}
        </div>
        <p className="tour-codex-foot">再次点击或按 M 键收起 · 花海继续流动</p>
      </section>
    </>
  );
};
