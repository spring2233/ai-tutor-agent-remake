import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Download,
  Eye,
  EyeOff,
  ImagePlus,
  Lock,
  LockOpen,
  Plus,
  RotateCw,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import './layout-editor.css';
import { loadProject, saveProject, subscribeToProject } from './store';
import { withBuiltinStickers } from './builtin';
import {
  ARTBOARD_HEIGHT,
  ARTBOARD_WIDTH,
  createId,
  emptyProject,
  isProject,
  normalizeProject,
  type Asset,
  type Layer,
  type LayoutProject,
} from './types';

const TAB_ID = createId();

type DragMode = 'move' | 'scale' | 'rotate';

interface DragState {
  mode: DragMode;
  layerId: string;
  moved: boolean;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  originScale: number;
  originRotation: number;
  startDist: number;
  startAngle: number;
}

function updatePage(project: LayoutProject, pageId: string, layers: Layer[]): LayoutProject {
  return {
    ...project,
    updatedAt: Date.now(),
    pages: project.pages.map((page) => (page.id === pageId ? { ...page, layers } : page)),
  };
}

function patchLayer(project: LayoutProject, pageId: string, layerId: string, patch: Partial<Layer>) {
  const page = project.pages.find((item) => item.id === pageId);
  if (!page) {
    return project;
  }
  return updatePage(
    project,
    pageId,
    page.layers.map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer)),
  );
}

function readImage(file: File): Promise<Asset> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const image = new Image();
      image.onload = () => {
        resolve({
          id: createId(),
          name: file.name.replace(/\.[^.]+$/, ''),
          dataUrl,
          width: image.naturalWidth || 200,
          height: image.naturalHeight || 200,
        });
      };
      image.onerror = () => reject(new Error('无法读取图片'));
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export const LayoutEditor = () => {
  const [project, setProject] = useState<LayoutProject>(emptyProject);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [pageName, setPageName] = useState('');
  const [preview, setPreview] = useState(false);
  const [status, setStatus] = useState('正在读取');
  const projectRef = useRef(project);
  const undoStack = useRef<LayoutProject[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const skipSave = useRef(true);

  projectRef.current = project;
  const page = project.pages.find((item) => item.id === project.activePageId) ?? project.pages[0];
  const assetsById = useMemo(
    () => new Map(project.assets.map((asset) => [asset.id, asset])),
    [project.assets],
  );

  const remember = useCallback(() => {
    undoStack.current.push(structuredClone(projectRef.current));
    if (undoStack.current.length > 50) {
      undoStack.current.shift();
    }
  }, []);

  const applyLocal = useCallback((next: LayoutProject) => {
    skipSave.current = false;
    setProject(next);
  }, []);

  useEffect(() => {
    let ignore = false;
    loadProject().then(async (loaded) => {
      if (ignore) {
        return;
      }
      const next = await withBuiltinStickers(loaded);
      if (ignore) {
        return;
      }
      const changed = next.updatedAt !== loaded.updatedAt;
      skipSave.current = !changed;
      setProject(next);
      setReady(true);
      if (!changed) {
        setStatus('已保存');
      }
    });
    const unsubscribe = subscribeToProject(TAB_ID, () => {
      loadProject().then((loaded) => {
        skipSave.current = true;
        undoStack.current = [];
        setProject(loaded);
        setStatus('已同步');
      });
    });
    return () => {
      ignore = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      saveProject(project, TAB_ID)
        .then(() => setStatus('已保存'))
        .catch(() => setStatus('保存失败'));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [project, ready]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreview(false);
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        const previous = undoStack.current.pop();
        if (previous) {
          applyLocal({ ...previous, updatedAt: Date.now() });
        }
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!selectedId || !page) {
          return;
        }
        const layer = page.layers.find((item) => item.id === selectedId);
        if (!layer || layer.locked) {
          return;
        }
        event.preventDefault();
        remember();
        applyLocal(updatePage(projectRef.current, page.id, page.layers.filter((item) => item.id !== selectedId)));
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyLocal, page, remember, selectedId]);

  const addAsset = async (file: File) => {
    const asset = await readImage(file);
    remember();
    const current = projectRef.current;
    applyLocal({
      ...current,
      updatedAt: Date.now(),
      assets: [...current.assets, asset],
    });
  };

  const addToCanvas = (asset: Asset) => {
    if (!page) {
      return;
    }
    remember();
    const layer: Layer = {
      id: createId(),
      assetId: asset.id,
      x: ARTBOARD_WIDTH / 2,
      y: ARTBOARD_HEIGHT / 2,
      width: Math.min(asset.width || 220, 280),
      scale: 1,
      rotation: 0,
      hidden: false,
      locked: false,
    };
    applyLocal(updatePage(projectRef.current, page.id, [...page.layers, layer]));
    setSelectedId(layer.id);
  };

  const startDrag = (event: React.PointerEvent, layer: Layer, mode: DragMode) => {
    if (layer.locked || layer.hidden) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(layer.id);
    const board = boardRef.current?.getBoundingClientRect();
    const pointX = board ? event.clientX - board.left : event.clientX;
    const pointY = board ? event.clientY - board.top : event.clientY;
    const drag: DragState = {
      mode,
      layerId: layer.id,
      moved: false,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: layer.x,
      originY: layer.y,
      originScale: layer.scale,
      originRotation: layer.rotation,
      startDist: Math.max(1, Math.hypot(pointX - layer.x, pointY - layer.y)),
      startAngle: Math.atan2(pointY - layer.y, pointX - layer.x),
    };

    const move = (pointer: PointerEvent) => {
      if (!drag.moved) {
        remember();
        drag.moved = true;
      }
      const rect = boardRef.current?.getBoundingClientRect();
      const x = rect ? pointer.clientX - rect.left : pointer.clientX;
      const y = rect ? pointer.clientY - rect.top : pointer.clientY;
      if (drag.mode === 'move') {
        applyLocal(patchLayer(projectRef.current, page.id, layer.id, {
          x: drag.originX + (pointer.clientX - drag.startClientX),
          y: drag.originY + (pointer.clientY - drag.startClientY),
        }));
        return;
      }
      if (drag.mode === 'scale') {
        const dist = Math.hypot(x - drag.originX, y - drag.originY);
        applyLocal(patchLayer(projectRef.current, page.id, layer.id, {
          scale: Math.min(8, Math.max(0.08, drag.originScale * (dist / drag.startDist))),
        }));
        return;
      }
      const angle = Math.atan2(y - drag.originY, x - drag.originX);
      applyLocal(patchLayer(projectRef.current, page.id, layer.id, {
        rotation: drag.originRotation + ((angle - drag.startAngle) * 180) / Math.PI,
      }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const createPage = () => {
    remember();
    const id = createId();
    const current = projectRef.current;
    applyLocal({
      ...current,
      updatedAt: Date.now(),
      activePageId: id,
      pages: [...current.pages, { id, name: `页面 ${current.pages.length + 1}`, layers: [] }],
    });
    setSelectedId(null);
  };

  const renamePage = (id: string, name: string) => {
    const trimmed = name.trim() || '未命名';
    remember();
    const current = projectRef.current;
    applyLocal({
      ...current,
      updatedAt: Date.now(),
      pages: current.pages.map((item) => (item.id === id ? { ...item, name: trimmed } : item)),
    });
  };

  const reorderLayer = (fromId: string, toId: string) => {
    if (!page || fromId === toId) {
      return;
    }
    const visual = [...page.layers].reverse();
    const fromIndex = visual.findIndex((layer) => layer.id === fromId);
    const toIndex = visual.findIndex((layer) => layer.id === toId);
    if (fromIndex < 0 || toIndex < 0) {
      return;
    }
    const [moved] = visual.splice(fromIndex, 1);
    visual.splice(toIndex, 0, moved);
    remember();
    applyLocal(updatePage(projectRef.current, page.id, visual.reverse()));
  };

  const exportProject = () => {
    const blob = new Blob([JSON.stringify(projectRef.current)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'layout-project.json';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const importProject = async (file: File) => {
    const parsed = JSON.parse(await file.text());
    if (!isProject(parsed)) {
      setStatus('无法读取项目');
      return;
    }
    const next = { ...normalizeProject(parsed), updatedAt: Date.now() };
    undoStack.current = [];
    applyLocal(next);
    setSelectedId(null);
  };

  const undo = () => {
    const previous = undoStack.current.pop();
    if (previous) {
      applyLocal({ ...previous, updatedAt: Date.now() });
    }
  };

  const artboard = (interactive: boolean) => (
    <div
      ref={interactive ? boardRef : undefined}
      className="layout-artboard"
      onPointerDown={interactive ? () => setSelectedId(null) : undefined}
    >
      {page?.layers.map((layer) => {
        const asset = assetsById.get(layer.assetId);
        if (!asset || layer.hidden) {
          return null;
        }
        const selected = interactive && layer.id === selectedId;
        return (
          <div
            key={layer.id}
            className={`layout-item${selected ? ' selected' : ''}`}
            style={{
              left: layer.x,
              top: layer.y,
              transform: `translate(-50%, -50%) rotate(${layer.rotation}deg) scale(${layer.scale})`,
            }}
            onPointerDown={interactive ? (event) => startDrag(event, layer, 'move') : undefined}
          >
            <img src={asset.dataUrl} alt="" draggable={false} style={{ width: layer.width }} />
            {selected && !layer.locked && (
              <>
                <button
                  type="button"
                  className="layout-handle rotate"
                  aria-label="旋转"
                  onPointerDown={(event) => startDrag(event, layer, 'rotate')}
                >
                  <RotateCw size={12} />
                </button>
                <button
                  type="button"
                  className="layout-handle scale"
                  aria-label="缩放"
                  onPointerDown={(event) => startDrag(event, layer, 'scale')}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );

  if (preview) {
    return (
      <div className="layout-preview">
        {artboard(false)}
        <button type="button" className="layout-preview-exit" onClick={() => setPreview(false)}>
          返回编辑
        </button>
      </div>
    );
  }

  return (
    <div className="layout-editor">
      <header className="layout-top">
        <div className="layout-pages">
          {project.pages.map((item) => (
            editingPageId === item.id ? (
              <input
                key={item.id}
                className="layout-page-input"
                value={pageName}
                autoFocus
                onChange={(event) => setPageName(event.target.value)}
                onBlur={() => {
                  renamePage(item.id, pageName);
                  setEditingPageId(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                }}
              />
            ) : (
              <button
                key={item.id}
                type="button"
                className={`layout-page${item.id === page?.id ? ' active' : ''}`}
                onClick={() => {
                  applyLocal({ ...projectRef.current, activePageId: item.id, updatedAt: Date.now() });
                  setSelectedId(null);
                }}
                onDoubleClick={() => {
                  setEditingPageId(item.id);
                  setPageName(item.name);
                }}
              >
                {item.name}
              </button>
            )
          ))}
          <button type="button" className="layout-icon" onClick={createPage} aria-label="新建页面">
            <Plus size={16} />
          </button>
        </div>
        <div className="layout-actions">
          <span className="layout-status">{status}</span>
          <button type="button" className="layout-icon" onClick={undo} aria-label="撤销">
            <Undo2 size={16} />
          </button>
          <button type="button" className="layout-icon" onClick={() => setPreview(true)} aria-label="预览">
            <Eye size={16} />
          </button>
          <button type="button" className="layout-icon" onClick={exportProject} aria-label="导出">
            <Download size={16} />
          </button>
          <button type="button" className="layout-icon" onClick={() => importRef.current?.click()} aria-label="导入">
            <Upload size={16} />
          </button>
          <Link to="/" className="layout-back">返回</Link>
        </div>
      </header>

      <aside className="layout-assets">
        <div className="layout-panel-title">
          素材
          <button type="button" onClick={() => uploadRef.current?.click()}>
            <ImagePlus size={15} />
            上传
          </button>
        </div>
        <input
          ref={uploadRef}
          type="file"
          accept="image/png,image/webp,image/gif,image/svg+xml,image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) {
              addAsset(file).catch(() => setStatus('无法读取图片'));
            }
          }}
        />
        <input
          ref={importRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) {
              importProject(file).catch(() => setStatus('无法读取项目'));
            }
          }}
        />
        <div className="layout-asset-list">
          {project.assets.length === 0 && <p>上传透明图片，再点一下放到画布。</p>}
          {project.assets.map((asset) => (
            <button key={asset.id} type="button" className="layout-asset" onClick={() => addToCanvas(asset)}>
              <img src={asset.dataUrl} alt="" />
              <span>{asset.name}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="layout-stage">{artboard(true)}</main>

      <aside className="layout-layers">
        <div className="layout-panel-title">图层</div>
        <div className="layout-layer-list">
          {page && [...page.layers].reverse().map((layer) => {
            const asset = assetsById.get(layer.assetId);
            return (
              <div
                key={layer.id}
                className={`layout-layer${layer.id === selectedId ? ' selected' : ''}`}
                draggable
                onDragStart={(event) => event.dataTransfer.setData('text/plain', layer.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  reorderLayer(event.dataTransfer.getData('text/plain'), layer.id);
                }}
                onClick={() => setSelectedId(layer.id)}
              >
                <span>{asset?.name || '缺失素材'}</span>
                <button
                  type="button"
                  aria-label={layer.hidden ? '显示' : '隐藏'}
                  onClick={(event) => {
                    event.stopPropagation();
                    remember();
                    applyLocal(patchLayer(projectRef.current, page.id, layer.id, { hidden: !layer.hidden }));
                  }}
                >
                  {layer.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  type="button"
                  aria-label={layer.locked ? '解锁' : '锁定'}
                  onClick={(event) => {
                    event.stopPropagation();
                    remember();
                    applyLocal(patchLayer(projectRef.current, page.id, layer.id, { locked: !layer.locked }));
                  }}
                >
                  {layer.locked ? <Lock size={14} /> : <LockOpen size={14} />}
                </button>
                <button
                  type="button"
                  aria-label="删除"
                  onClick={(event) => {
                    event.stopPropagation();
                    remember();
                    applyLocal(updatePage(projectRef.current, page.id, page.layers.filter((item) => item.id !== layer.id)));
                    if (selectedId === layer.id) {
                      setSelectedId(null);
                    }
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
          {page?.layers.length === 0 && <p>这个页面还没有图层。</p>}
        </div>
      </aside>
    </div>
  );
};
