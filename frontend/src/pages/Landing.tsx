import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Bookshelf, type LibraryDocument } from '../components/library/Bookshelf';
import { useCosmos } from '../cosmos/CosmosContext';
import { markEntered } from './landingIntro';
import './landing.css';

const CURRENT_DOCUMENT_KEY = 'ai-tutor-current-document-v2';
const CURRENT_DOCUMENT_NAME_KEY = 'ai-tutor-current-document-name-v2';

export const Landing = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const panel = params.get('panel');
  const { scene, loaded, introDone, refreshLibrary } = useCosmos();
  const [uiOn, setUiOn] = useState(introDone);
  const [libraryVersion, setLibraryVersion] = useState(0);

  useEffect(() => {
    if (introDone) setUiOn(true);
  }, [introDone]);

  useEffect(() => {
    scene?.setViewMode('landing');
  }, [scene]);

  const openPanel = (next: 'upload' | 'library') => {
    markEntered();
    if (next === 'library') {
      navigate('/chat');
      return;
    }
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
    navigate(`/explore?document=${document.id}`);
  };

  const toggleSound = () => {
    if (!scene) return;
    const muted = scene.toggleMute();
    const button = document.getElementById('sound');
    if (button) {
      button.setAttribute('aria-pressed', String(!muted));
    }
  };

  return (
    <div className="landing-root">
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
                onPointerEnter={() => scene?.startHoverTransition()}
                onPointerLeave={() => scene?.stopHoverTransition()}
              >
                <span className="gate-kicker">01</span>
                <strong>上传内容</strong>
                <span>把 PDF 放进星图档案</span>
              </button>
              <button
                type="button"
                className="gate-card"
                onClick={() => openPanel('library')}
                onPointerEnter={() => scene?.startHoverTransition()}
                onPointerLeave={() => scene?.stopHoverTransition()}
              >
                <span className="gate-kicker">02</span>
                <strong>查看已有内容</strong>
                <span>阅读，或降落星球探索</span>
              </button>
              <button
                type="button"
                className="gate-card gate-card-gallery"
                onClick={() => {
                  markEntered();
                  navigate('/gallery');
                }}
                onPointerEnter={() => scene?.startHoverTransition()}
                onPointerLeave={() => scene?.stopHoverTransition()}
              >
                <span className="gate-kicker">03</span>
                <strong>星界鉴赏室</strong>
                <span>巡礼已全部点亮的星球与知识星碑</span>
              </button>
            </div>
          </section>
        )}

        {panel === 'upload' ? (
          <div className="glass-panel">
            <button type="button" className="glass-close" onClick={closePanel}>
              返回星空
            </button>
            <Bookshelf
              refreshToken={libraryVersion}
              variant="upload"
              onExplore={startQuest}
              onUploaded={(created) => {
                setLibraryVersion((value) => value + 1);
                refreshLibrary().catch(() => undefined);
                markEntered();
                navigate(created?.id ? `/chat?spawn=${created.id}` : '/chat');
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
