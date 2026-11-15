import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CosmosScene } from '../cosmos/CosmosScene';
import { QuestView } from '../components/quest/QuestView';
import './landing.css';

export const QuestStage = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CosmosScene | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const scene = new CosmosScene(
      root,
      () => setReady(true),
      () => undefined,
      { skipIntro: true, mode: 'arena' },
    );
    sceneRef.current = scene;
    scene.initAudio();
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  return (
    <div className="landing-root quest-stage" ref={rootRef}>
      <div id="cosmos" aria-hidden="true">
        <div className="js-canvas-container" />
      </div>
      <div className="landing-ui on quest-hud">
        <header className="landing-header">
          <Link className="landing-logo" to="/?panel=library" aria-label="返回档案">
            AI 导师
          </Link>
          <Link className="pill hud-pill" to="/?panel=library">
            返回档案
          </Link>
        </header>
        <div className="quest-hud-body">
          <QuestView />
        </div>
      </div>
      <div className={`landing-loader${ready ? ' gone' : ''}`}>
        <span />
      </div>
    </div>
  );
};
