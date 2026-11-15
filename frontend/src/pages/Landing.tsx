import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CosmosScene } from '../cosmos/CosmosScene';
import { Bookshelf, type LibraryDocument } from '../components/library/Bookshelf';
import './landing.css';

export const LANDING_INTRO_KEY = 'ai-tutor-landing-intro';
const CURRENT_DOCUMENT_KEY = 'ai-tutor-current-document-v2';
const CURRENT_DOCUMENT_NAME_KEY = 'ai-tutor-current-document-name-v2';

function markEntered() {
  try {
    sessionStorage.setItem(LANDING_INTRO_KEY, '1');
  } catch {
    /* ignore */
  }
}

export const Landing = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const panel = params.get('panel');
  const rootRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CosmosScene | null>(null);
  const [uiOn, setUiOn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const skipIntro = (() => {
    try {
      return sessionStorage.getItem(LANDING_INTRO_KEY) === '1';
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    let introShown = skipIntro;
    const scene = new CosmosScene(
      root,
      () => setLoaded(true),
      () => {
        if (!introShown) {
          introShown = true;
          setUiOn(true);
        }
      },
      { skipIntro, mode: 'wander' },
    );
    sceneRef.current = scene;
    if (skipIntro) {
      setUiOn(true);
    }
    scene.initAudio();
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [skipIntro]);

  const openPanel = (next: 'upload' | 'library') => {
    markEntered();
    setParams({ panel: next }, { replace: true });
  };

  const closePanel = () => {
    navigate('/', { replace: true });
  };

  const rememberDocument = (document: LibraryDocument) => {
    localStorage.setItem(CURRENT_DOCUMENT_KEY, document.id);
    localStorage.setItem(CURRENT_DOCUMENT_NAME_KEY, document.name);
  };

  const startQuest = (document: LibraryDocument) => {
    rememberDocument(document);
    markEntered();
    navigate(`/quest?document=${document.id}`);
  };

  const toggleSound = () => {
    const scene = sceneRef.current;
    if (!scene) {
      return;
    }
    const muted = scene.toggleMute();
    const button = document.getElementById('sound');
    if (button) {
      button.setAttribute('aria-pressed', String(!muted));
    }
  };

  return (
    <div className="landing-root" ref={rootRef}>
      <div id="cosmos" aria-hidden="true">
        <div className="js-canvas-container" />
      </div>
      <div className={`landing-ui${uiOn ? ' on' : ''}`} id="ui">
        <header className="landing-header">
          <Link className="landing-logo" to="/" aria-label="AI 导师">
            AI 导师
          </Link>
        </header>

        {!panel && (
          <section className="landing-hero">
            <h1>Learn, not drift.</h1>
            <p className="landing-cap">
              文档里长知识。
              <br />
              星图里找路径。
            </p>
            <div className="gate-row">
              <button
                type="button"
                className="gate-card"
                onClick={() => openPanel('upload')}
                onPointerEnter={() => sceneRef.current?.startHoverTransition()}
                onPointerLeave={() => sceneRef.current?.stopHoverTransition()}
              >
                <span className="gate-kicker">01</span>
                <strong>上传内容</strong>
                <span>把 PDF 放进星图档案</span>
              </button>
              <button
                type="button"
                className="gate-card"
                onClick={() => openPanel('library')}
                onPointerEnter={() => sceneRef.current?.startHoverTransition()}
                onPointerLeave={() => sceneRef.current?.stopHoverTransition()}
              >
                <span className="gate-kicker">02</span>
                <strong>查看已有内容</strong>
                <span>阅读或从一份材料闯关</span>
              </button>
            </div>
          </section>
        )}

        {panel === 'upload' || panel === 'library' ? (
          <div className="glass-panel">
            <button type="button" className="glass-close" onClick={closePanel}>
              返回星空
            </button>
            <Bookshelf
              refreshToken={libraryVersion}
              variant={panel === 'upload' ? 'upload' : 'library'}
              onExplore={startQuest}
              onUploaded={() => {
                setLibraryVersion((value) => value + 1);
                if (panel === 'upload') {
                  setParams({ panel: 'library' }, { replace: true });
                }
              }}
            />
          </div>
        ) : null}

        <div className="landing-corner">
          <span>Scroll to wander</span>
          <i />
          <button
            className="sound"
            id="sound"
            type="button"
            aria-pressed="false"
            aria-label="Ambient sound"
            onClick={toggleSound}
          >
            <svg viewBox="0 0 24 24">
              <path d="M4 9.5v5h3.5L12 18V6L7.5 9.5Z" />
              <path className="w" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
              <path className="x" d="m16 10 4 4m0-4-4 4" />
            </svg>
          </button>
        </div>
      </div>
      <div className={`landing-loader${loaded ? ' gone' : ''}`} id="loader">
        <span />
      </div>
    </div>
  );
};
