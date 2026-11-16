import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Upload } from 'lucide-react';
import { apiErrorMessage } from '../api/httpError';
import { useCosmos } from '../cosmos/CosmosContext';
import { markEntered } from './landingIntro';
import './landing.css';
import './galaxy.css';

export const GalaxyArchive = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { scene, loaded, introDone, anchors, hoveredId, documents, refreshLibrary, rememberDocument } =
    useCosmos();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const spawnHandled = useRef('');

  const selectedId = params.get('focus');
  const selected = documents.find((d) => d.id === selectedId) || documents.find((d) => d.id === scene?.getActiveId());

  useEffect(() => {
    markEntered();
    scene?.setViewMode(params.get('focus') ? 'orbit' : 'galaxy');
    scene?.setCallbacks({
      onPlanetClick: (id) => {
        const doc = documents.find((item) => item.id === id);
        if (!doc) return;
        rememberDocument({ id: doc.id, name: doc.name || doc.filename || doc.id });
        scene.focusPlanet(id);
        setParams({ focus: id }, { replace: true });
      },
      onUploadPortalClick: () => fileRef.current?.click(),
    });
  }, [scene, documents, rememberDocument, setParams, params]);

  useEffect(() => {
    const spawnId = params.get('spawn');
    if (!spawnId || !scene || spawnHandled.current === spawnId) return;
    const doc = documents.find((item) => item.id === spawnId);
    if (!doc) return;
    spawnHandled.current = spawnId;
    scene.spawnPlanetAnimation(doc);
    setParams({}, { replace: true });
  }, [params, documents, scene, setParams]);

  const openUpload = () => fileRef.current?.click();

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    setUploading(true);
    setError('');
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.message || '上传失败');
      const list = await refreshLibrary();
      const created = list.find((item) => item.id === data.document_id) || {
        id: data.document_id,
        name: data.name,
      };
      rememberDocument({ id: created.id, name: created.name || data.name });
      scene?.spawnPlanetAnimation(created);
    } catch (err) {
      setError(apiErrorMessage(err, '上传失败'));
    } finally {
      setUploading(false);
    }
  };

  const goBackGalaxy = () => {
    scene?.setViewMode('galaxy');
    setParams({}, { replace: true });
  };

  const enter = (path: string) => {
    if (!selected) return;
    rememberDocument({ id: selected.id, name: selected.name || selected.id });
    navigate(`${path}?document=${selected.id}`);
  };

  return (
    <div className={`landing-root star-stage${introDone ? ' on' : ''}`}>
      <div className={`landing-ui${introDone ? ' on' : ''}`}>
        <div className="star-map">
          <div className="star-map-bar">
            <Link className="landing-logo" to="/" aria-label="AI 导师">
              AI 导师
            </Link>
            <button className="btn hud-glass" type="button" onClick={openUpload} disabled={uploading}>
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {uploading ? '正在创世…' : '创造新世界'}
            </button>
          </div>

          {error ? <p className="shelf-error" style={{ position: 'absolute', top: 72, left: 24 }}>{error}</p> : null}

          {anchors.map((anchor) =>
            anchor.visible ? (
              <button
                key={anchor.id}
                type="button"
                className="star-label"
                style={{ left: anchor.x, top: anchor.y }}
                onClick={() => {
                  if (anchor.id === '__core__') {
                    openUpload();
                    return;
                  }
                  rememberDocument({ id: anchor.id, name: anchor.name });
                  scene?.focusPlanet(anchor.id);
                  setParams({ focus: anchor.id }, { replace: true });
                }}
                onPointerEnter={() => undefined}
              >
                <svg viewBox="0 0 46 28" aria-hidden="true">
                  <path d="M0 28 L18 10 H46" fill="none" stroke="rgba(245,239,226,0.7)" strokeWidth="1" />
                </svg>
                <span className="star-label-copy">
                  <span className="star-label-kicker">
                    {anchor.id === '__core__' ? 'CORE // 00' : `WORLD // ${String(anchor.index + 1).padStart(2, '0')}`}
                  </span>
                  <span className="star-label-name">{anchor.name}</span>
                  <span className="star-badge">{anchor.id === '__core__' ? '待唤醒' : '已归档'}</span>
                </span>
              </button>
            ) : null,
          )}

          {anchors
            .filter((anchor) => anchor.visible && (hoveredId === anchor.id || selectedId === anchor.id))
            .map((anchor) => (
              <i key={`ret-${anchor.id}`} className="star-reticle" style={{ left: anchor.x, top: anchor.y }} />
            ))}

          {selected && params.get('focus') ? (
            <aside className="planet-panel">
              <div className="eyebrow">全息行动</div>
              <h2>{selected.name}</h2>
              <p>停靠该星球轨道。右侧面板不会挡住星体。</p>
              <div className="planet-actions">
                <button className="btn btn-primary" type="button" onClick={() => enter('/ask')}>
                  进入深度问答
                </button>
                <button className="btn" type="button" onClick={() => enter('/quest')}>
                  开启星球探索（闯关）
                </button>
                <button className="btn" type="button" onClick={() => enter('/flashcards')}>
                  知识闪卡
                </button>
                <button className="btn" type="button" onClick={goBackGalaxy}>
                  返回星系总览
                </button>
              </div>
            </aside>
          ) : null}

          <div className="star-map-footer">
            <input ref={fileRef} type="file" accept=".pdf" hidden onChange={handleUpload} />
            <span className="landing-corner" style={{ position: 'static' }}>
              {documents.length === 0 ? '上传第一份 PDF，点亮宇宙' : '拖拽旋转 · 滚轮远近'}
            </span>
          </div>
        </div>
      </div>
      <div className={`landing-loader${loaded ? ' gone' : ''}`}>
        <span />
      </div>
    </div>
  );
};
