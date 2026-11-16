import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import {
  CosmosScene,
  type DocumentItem,
  type PlanetAnchor,
  type ViewMode,
} from './CosmosScene2';
import { LANDING_INTRO_KEY } from '../pages/landingIntro';

const CURRENT_DOCUMENT_KEY = 'ai-tutor-current-document-v2';
const CURRENT_DOCUMENT_NAME_KEY = 'ai-tutor-current-document-name-v2';

interface CosmosApi {
  scene: CosmosScene | null;
  loaded: boolean;
  introDone: boolean;
  anchors: PlanetAnchor[];
  hoveredId: string | null;
  documents: DocumentItem[];
  refreshLibrary: () => Promise<DocumentItem[]>;
  rememberDocument: (doc: { id: string; name: string }) => void;
}

const CosmosContext = createContext<CosmosApi | null>(null);

export function useCosmos() {
  const value = useContext(CosmosContext);
  if (!value) {
    throw new Error('useCosmos must be used inside CosmosProvider');
  }
  return value;
}

export function CosmosProvider({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CosmosScene | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [anchors, setAnchors] = useState<PlanetAnchor[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const hoverTick = useRef(0);

  const skipIntro = (() => {
    try {
      return sessionStorage.getItem(LANDING_INTRO_KEY) === '1';
    } catch {
      return false;
    }
  })();

  const refreshLibrary = useCallback(async () => {
    const res = await fetch('/api/documents');
    const data = await res.json();
    const list: DocumentItem[] = Array.isArray(data.documents)
      ? data.documents.map((d: { id: string; name: string; pages?: number }) => ({
          id: d.id,
          name: d.name,
          filename: d.name,
          pages: d.pages,
          status: 'archived',
        }))
      : [];
    setDocuments(list);
    sceneRef.current?.syncPlanets(list, localStorage.getItem(CURRENT_DOCUMENT_KEY) || undefined);
    return list;
  }, []);

  const rememberDocument = useCallback((doc: { id: string; name: string }) => {
    localStorage.setItem(CURRENT_DOCUMENT_KEY, doc.id);
    localStorage.setItem(CURRENT_DOCUMENT_NAME_KEY, doc.name);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const scene = new CosmosScene(root, {
      skipIntro,
      onLoaded: () => setLoaded(true),
      onIntroDone: () => setIntroDone(true),
      onAnchors: (next) => {
        setAnchors((prev) => {
          if (prev.length === next.length) {
            let same = true;
            for (let i = 0; i < next.length; i += 1) {
              if (
                prev[i].id !== next[i].id ||
                Math.abs(prev[i].x - next[i].x) > 1.5 ||
                Math.abs(prev[i].y - next[i].y) > 1.5 ||
                prev[i].visible !== next[i].visible
              ) {
                same = false;
                break;
              }
            }
            if (same) return prev;
          }
          return next;
        });
        hoverTick.current += 1;
        if (hoverTick.current % 4 === 0) {
          setHoveredId(sceneRef.current?.getHoveredId() ?? null);
        }
      },
    });
    sceneRef.current = scene;
    if (skipIntro) {
      setIntroDone(true);
    }
    scene.initAudio();
    refreshLibrary().catch(() => undefined);
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [refreshLibrary, skipIntro]);

  const value = useMemo<CosmosApi>(
    () => ({
      scene: sceneRef.current,
      loaded,
      introDone,
      anchors,
      hoveredId,
      documents,
      refreshLibrary,
      rememberDocument,
    }),
    [loaded, introDone, anchors, hoveredId, documents, refreshLibrary, rememberDocument],
  );

  return (
    <CosmosContext.Provider value={value}>
      <div id="cosmos" className="cosmos-layer" aria-hidden="true" ref={rootRef}>
        <div className="js-canvas-container" />
      </div>
      {children}
    </CosmosContext.Provider>
  );
}

export function CosmosModeBridge() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { scene, loaded } = useCosmos();

  useEffect(() => {
    if (!scene || !loaded) return;
    let mode: ViewMode = 'landing';
    if (pathname === '/chat' && !params.get('focus') && !params.get('document')) {
      mode = 'galaxy';
    } else if (pathname === '/chat') {
      mode = params.get('hud') || params.get('focus') ? 'orbit' : 'galaxy';
    } else if (pathname === '/ask' || pathname === '/quest' || pathname === '/flashcards') {
      mode = 'orbit';
    } else if (pathname === '/') {
      mode = 'landing';
    } else if (pathname === '/layout') {
      mode = 'galaxy';
    }
    scene.setViewMode(mode);
    const docId = params.get('document') || localStorage.getItem(CURRENT_DOCUMENT_KEY);
    if (mode === 'orbit' && docId) {
      scene.focusPlanet(docId);
    }
  }, [pathname, params, scene, loaded]);

  return null;
}
