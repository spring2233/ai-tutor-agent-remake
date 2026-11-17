import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useCosmos } from '../cosmos/CosmosContext';
import { PlanetEmblem } from '../cosmos/PlanetEmblem';
import { THEME_PALETTES } from '../cosmos/planetIdentity';
import { codexFor, getDocumentProgress, loadZoneSave } from '../components/explore/zones';
import { monolithsFor } from '../data/planetPresets';
import { markEntered } from './landingIntro';
import './landing.css';
import './galaxy.css';
import './gallery.css';

const TOUR_STEP_MS = 6500;

export const StarGallery = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { scene, loaded, documents, rememberDocument } = useCosmos();
  const tourId = params.get('tour');
  const [step, setStep] = useState(0);

  useEffect(() => {
    markEntered();
  }, []);

  const planets = useMemo(
    () =>
      documents
        .map((doc) => {
          const save = loadZoneSave(doc.id);
          return {
            doc,
            progress: getDocumentProgress(doc.id),
            zones: save?.zones ?? [],
            monoliths: monolithsFor(doc.id, save?.zones ?? []),
          };
        })
        .filter((p) => p.progress >= 100),
    [documents],
  );

  const touring = planets.find((p) => p.doc.id === tourId);

  useEffect(() => {
    setStep(0);
    if (!touring || touring.monoliths.length < 2) return;
    const timer = window.setInterval(() => setStep((s) => (s + 1) % touring.monoliths.length), TOUR_STEP_MS);
    return () => window.clearInterval(timer);
  }, [touring]);

  const startTour = (id: string) => {
    scene?.focusPlanet(id);
    setParams({ tour: id }, { replace: true });
  };

  const enterOrbit = (id: string, name: string) => {
    rememberDocument({ id, name });
    navigate(`/chat?focus=${id}`);
  };

  const enterSurface = (id: string, name: string) => {
    rememberDocument({ id, name });
    navigate(`/explore?document=${id}&tour=1`);
  };

  return (
    <div className="landing-root gallery-stage">
      <div className="landing-ui on">
        <header className="landing-header">
          <Link className="landing-logo" to="/" aria-label="返回首页">
            Starlore 知识星典
          </Link>
          <div className="gallery-nav">
            {touring ? (
              <button type="button" className="orbit-mode hud-glass" onClick={() => setParams({}, { replace: true })}>
                返回鉴赏室
              </button>
            ) : null}
            <Link to="/chat" className="orbit-mode hud-glass">
              星系总览
            </Link>
          </div>
        </header>

        {touring ? (
          <aside className="gallery-tour" aria-live="polite">
            <p className="gallery-kicker">纯享漫游 · {touring.doc.planetName}</p>
            {touring.monoliths[step] ? (
              <div className="gallery-tour-note" key={step}>
                <span>{touring.monoliths[step].title}</span>
                <p>{touring.monoliths[step].note}</p>
              </div>
            ) : null}
            <div className="gallery-dots">
              {touring.monoliths.map((m, i) => (
                <button
                  key={m.title}
                  type="button"
                  className={i === step ? 'on' : ''}
                  aria-label={m.title}
                  onClick={() => setStep(i)}
                />
              ))}
            </div>
          </aside>
        ) : (
          <section className="gallery-panel">
            <p className="gallery-kicker">03 · 星界鉴赏室</p>
            <h1>已全部点亮的星球</h1>
            <p className="gallery-lead">每颗星都由一份 PDF 化成。100% 完成后自动入馆，可回看星碑，或进入轨道纯享漫游。</p>

            {planets.length === 0 ? (
              <p className="gallery-empty">还没有完全点亮的星球。去星系里挑一颗开始探索吧。</p>
            ) : (
              <div className="gallery-grid">
                {planets.map(({ doc, monoliths, zones }) => {
                  const palette = doc.themePalette ?? THEME_PALETTES.ai_cs;
                  return (
                    <article className="gallery-card" key={doc.id} style={{ borderColor: `${palette.corona}55` }}>
                      <div className="gallery-card-head">
                        <PlanetEmblem id={doc.id} palette={palette} progress={100} size={58} />
                        <div>
                          <h2>{doc.planetName || doc.name}</h2>
                          <span className="gallery-file">
                            {doc.filename || doc.name}
                            {doc.isPreset ? ' · 旗舰示范星' : ''}
                          </span>
                        </div>
                        <span className="gallery-badge">✦ 100%</span>
                      </div>
                      {doc.themeSummary ? <p className="gallery-summary">{doc.themeSummary}</p> : null}
                      <ol className="gallery-monoliths">
                        {monoliths.map((m) => (
                          <li key={m.title}>
                            <span>{m.title}</span>
                            {m.note}
                          </li>
                        ))}
                      </ol>
                      {zones.some((z) => codexFor(doc.id, z).length > 0) ? (
                        <details className="gallery-codex">
                          <summary>章节知识星碑 · {zones.length} 章</summary>
                          {zones.map((z, i) => {
                            const rows = codexFor(doc.id, z);
                            if (!rows.length) return null;
                            return (
                              <section key={z.id}>
                                <h3>
                                  ZONE {String(i + 1).padStart(2, '0')} · {z.title}
                                </h3>
                                <ol>
                                  {rows.map((row) => (
                                    <li key={row.label + row.truth}>
                                      <span>{row.label}</span>
                                      {row.truth}
                                      {row.note ? <em>{row.note}</em> : null}
                                    </li>
                                  ))}
                                </ol>
                              </section>
                            );
                          })}
                        </details>
                      ) : null}
                      <div className="gallery-actions">
                        <button type="button" className="btn btn-primary" onClick={() => startTour(doc.id)}>
                          纯享漫游
                        </button>
                        <button type="button" className="btn" onClick={() => enterOrbit(doc.id, doc.name || doc.id)}>
                          进入轨道
                        </button>
                        <button type="button" className="btn" onClick={() => enterSurface(doc.id, doc.name || doc.id)}>
                          地表纯享漫游
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
      <div className={`landing-loader${loaded ? ' gone' : ''}`}>
        <span />
      </div>
    </div>
  );
};
