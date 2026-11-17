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
import {
  ensureFrontier,
  getDocumentProgress,
  loadZoneSave,
  ZONES_UPDATED_EVENT,
} from '../components/explore/zones';
import { resolvePlanetIdentity } from './planetIdentity';
import { presetRecords } from '../data/planetPresets';

interface ApiDocument {
  id: string;
  name: string;
  pages?: number;
  planetName?: string;
  themeCategory?: string;
  themeSummary?: string;
}

/** 预置示范星 + 后端文档，统一补齐星球名、主题配色与进度。 */
function toPlanetItems(apiDocs: ApiDocument[]): DocumentItem[] {
  const presets: DocumentItem[] = presetRecords().map((p) => ({
    id: p.id,
    name: p.fileName,
    filename: p.fileName,
    pages: p.pages,
    status: 'archived',
    planetName: p.planetName,
    themeSummary: p.themeSummary,
    themePalette: p.themePalette,
    progress: getDocumentProgress(p.id),
    isPreset: true,
  }));
  const uploaded: DocumentItem[] = apiDocs.map((d) => {
    const save = loadZoneSave(d.id);
    const identity = resolvePlanetIdentity({
      id: d.id,
      fileName: d.name,
      planetName: d.planetName,
      themeCategory: d.themeCategory,
      themeSummary: d.themeSummary,
      zoneHints: save?.zones.map((z) => z.zoneTitle || z.title),
      progress: getDocumentProgress(d.id),
    });
    return {
      id: d.id,
      name: d.name,
      filename: d.name,
      pages: d.pages,
      status: 'archived',
      planetName: identity.planetName,
      themeSummary: identity.themeSummary,
      themePalette: identity.themePalette,
      progress: identity.progress,
    };
  });
  return [...uploaded, ...presets];
}

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
    // 后端没起时仍展示两颗预置示范星，星图和鉴赏室不会空
    let apiDocs: ApiDocument[] = [];
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      if (Array.isArray(data.documents)) apiDocs = data.documents;
    } catch {
      apiDocs = [];
    }
    const list = toPlanetItems(apiDocs);
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
    // 不改 documents 状态：否则 CosmosModeBridge 会重新 focus，探索中的镜头会跳
    const onZones = (event: Event) => {
      const id = (event as CustomEvent<{ documentId?: string }>).detail?.documentId;
      if (id) scene.setPlanetProgress(id, getDocumentProgress(id));
    };
    window.addEventListener(ZONES_UPDATED_EVENT, onZones);
    return () => {
      window.removeEventListener(ZONES_UPDATED_EVENT, onZones);
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
  const { scene, loaded, documents } = useCosmos();

  // documents 也是依赖：直接打开带 ?document= 的轨道页时，星球要等书架加载后才存在
  useEffect(() => {
    if (!scene || !loaded) return;
    // 地表穿门期间书架刷新不能把镜头拽回轨道；离开 /explore 时照常切换
    if (scene.viewMode === 'surface' && pathname === '/explore') return;
    let mode: ViewMode = 'landing';
    if (pathname === '/chat' && !params.get('focus') && !params.get('document')) {
      mode = 'galaxy';
    } else if (pathname === '/chat') {
      mode = params.get('hud') || params.get('focus') ? 'orbit' : 'galaxy';
    } else if (pathname === '/ask' || pathname === '/explore') {
      mode = 'orbit';
    } else if (pathname === '/gallery') {
      mode = params.get('tour') ? 'orbit' : 'galaxy';
    } else if (pathname === '/') {
      mode = 'landing';
    } else if (pathname === '/layout') {
      mode = 'galaxy';
    }
    scene.setViewMode(mode);
    const docId =
      params.get('tour') || params.get('focus') || params.get('document') || localStorage.getItem(CURRENT_DOCUMENT_KEY);
    if (mode === 'orbit' && docId) {
      scene.focusPlanet(docId);
      // 已探索过的星球：停靠轨道时就显示地表信标与已点亮区域
      const save = loadZoneSave(docId);
      if (save) {
        scene.setSurfaceZones(
          docId,
          ensureFrontier(save.zones).map((z) => ({ id: z.id, title: z.title, status: z.status })),
        );
      }
    }
  }, [pathname, params, scene, loaded, documents]);

  return null;
}
