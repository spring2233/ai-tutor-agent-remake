import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Loader2, Swords, Trash2, Upload } from 'lucide-react';
import { apiErrorMessage } from '../../api/httpError';

const CONDENSE_STAGES = [
  { code: 'STAGE 01', label: '提取文档语义切片' },
  { code: 'STAGE 02', label: '测绘星球地表知识区域' },
  { code: 'STAGE 03', label: '注入星核能量并点亮坐标' },
];
const STAGE_TWO_AT_MS = 1600;
const STAGE_THREE_AT_MS = 4200;
const IGNITE_HOLD_MS = 900;

const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

export interface LibraryDocument {
  id: string;
  name: string;
  pages: number;
  chunks: number;
  uploaded_at: string;
}

function coverTitle(fileName: string) {
  const bare = fileName.replace(/\.pdf$/i, '').trim();
  if (!bare) {
    return '未命名';
  }
  if (/\s/.test(bare)) {
    return bare.split(/\s+/).slice(0, 10).join(' ');
  }
  return Array.from(bare).slice(0, 10).join('');
}

interface BookshelfProps {
  refreshToken: number;
  variant?: 'library' | 'upload';
  onExplore: (document: LibraryDocument) => void;
  onUploaded: (created?: { id: string; name: string }) => void;
}

export const Bookshelf = ({
  refreshToken,
  variant = 'library',
  onExplore,
  onUploaded,
}: BookshelfProps) => {
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [reading, setReading] = useState<LibraryDocument | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState(0);
  const [ignited, setIgnited] = useState(false);
  const [pendingName, setPendingName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const stageTimers = useRef<number[]>([]);

  const clearStageTimers = () => {
    stageTimers.current.forEach((id) => window.clearTimeout(id));
    stageTimers.current = [];
  };

  useEffect(() => clearStageTimers, []);

  const loadDocuments = async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || '无法加载书架');
      }
      setDocuments(Array.isArray(data.documents) ? data.documents : []);
    } catch (err) {
      console.error(err);
      setError('无法加载已上传的 PDF。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [refreshToken]);

  const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    setIsUploading(true);
    setError('');
    if (variant === 'upload') {
      clearStageTimers();
      setPendingName(file.name);
      setIgnited(false);
      setStage(1);
      stageTimers.current = [
        window.setTimeout(() => setStage(2), STAGE_TWO_AT_MS),
        window.setTimeout(() => setStage(3), STAGE_THREE_AT_MS),
      ];
    }
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || '上传失败');
      }
      if (variant === 'upload') {
        clearStageTimers();
        setStage(3);
        setIgnited(true);
        await new Promise((resolve) => window.setTimeout(resolve, IGNITE_HOLD_MS));
      }
      onUploaded(
        data.document_id
          ? { id: data.document_id as string, name: (data.name as string) || file.name }
          : undefined,
      );
      await loadDocuments();
    } catch (err) {
      clearStageTimers();
      setStage(0);
      setError(apiErrorMessage(err, '上传失败'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    uploadFile(file);
  };

  const handleDragOver = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (isUploading) return;
    event.dataTransfer.dropEffect = 'copy';
    if (!dragging) setDragging(true);
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    if (isUploading) return;
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (!isPdf(file)) {
      setError('只能投喂 PDF 典籍。');
      return;
    }
    uploadFile(file);
  };

  const handleDelete = async (document: LibraryDocument) => {
    if (!window.confirm(`从档案移除 ${document.name}？`)) {
      return;
    }
    const res = await fetch(`/api/documents/${document.id}`, { method: 'DELETE' });
    if (!res.ok) {
      setError('无法移除这份 PDF。');
      return;
    }
    if (reading?.id === document.id) {
      setReading(null);
    }
    await loadDocuments();
  };

  const uploadControl = (
    <div className="shelf-upload">
      <input
        id="shelf-upload"
        type="file"
        accept=".pdf"
        hidden
        onChange={handleUpload}
      />
      <label htmlFor="shelf-upload" className="btn btn-primary">
        {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
        {isUploading ? '正在切块并抽取知识单元…' : '上传 PDF'}
      </label>
    </div>
  );

  if (variant === 'upload') {
    return (
      <div className="protostar">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          hidden
          onChange={handleUpload}
        />
        <div className="protostar-head">
          <span className="protostar-kicker">GENESIS // 新星创世舱</span>
          <h2>
            把 PDF 放进这条<span className="protostar-accent">星图</span>
          </h2>
        </div>

        {stage === 0 ? (
          <>
            <button
              type="button"
              className={`protostar-zone${dragging ? ' is-drag' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragEnter={handleDragOver}
              onDragOver={handleDragOver}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              aria-label="拖入或选择一份 PDF 上传"
            >
              <span className="protostar-ring outer" />
              <span className="protostar-ring inner" />
              <span className="protostar-core" />
              <span className="protostar-title">
                {dragging ? '释放以开始星体凝聚' : '投喂典籍 · 凝聚新星'}
              </span>
              <span className="protostar-hint">
                {dragging ? 'RELEASE TO CONDENSE' : '拖入 PDF，或点击选择文件'}
              </span>
            </button>
            <p className="protostar-foot">支持 PDF 文档 · 自动切分知识星域并生成专属守门人关卡</p>
          </>
        ) : (
          <div className={`condense${ignited ? ' ignited' : ''}`} aria-live="polite">
            <div className="condense-core" />
            <p className="condense-file" title={pendingName}>
              {pendingName}
            </p>
            <ol className="condense-stages">
              {CONDENSE_STAGES.map((item, index) => {
                const step = index + 1;
                const state = ignited || stage > step ? 'done' : stage === step ? 'active' : 'idle';
                return (
                  <li key={item.code} className={`condense-stage ${state}`}>
                    <div className="condense-row">
                      <span className="condense-code">{item.code} //</span>
                      <span className="condense-label">{item.label}</span>
                      <span className="condense-state">
                        {state === 'done' ? 'OK' : state === 'active' ? 'SYNC' : 'WAIT'}
                      </span>
                    </div>
                    <span className="condense-bar">
                      <i />
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="condense-status">
              {ignited ? '新星已点亮 · 正在跃迁至星图' : '星体凝聚中，请保持舱门开启…'}
            </p>
          </div>
        )}

        {error && (
          <p className="protostar-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (reading) {
    return (
      <div className="reader-panel">
        <div className="reader-toolbar">
          <div>
            <div className="eyebrow">正在阅读</div>
            <h2>{reading.name}</h2>
          </div>
          <div className="reader-actions">
            <button className="btn btn-primary" type="button" onClick={() => onExplore(reading)}>
              <Swords size={16} />
              星球探索
            </button>
            <button className="btn" type="button" onClick={() => setReading(null)}>
              回到档案
            </button>
          </div>
        </div>
        <iframe
          className="pdf-frame"
          title={reading.name}
          src={`/api/documents/${reading.id}/file`}
        />
      </div>
    );
  }

  return (
    <div className="shelf-page">
      <div className="hero">
        <div className="eyebrow">星图档案</div>
        <h1>
          文档停泊在这条<span className="grad-text">星图</span>
        </h1>
        <p>打开一份阅读，或降落到这颗星球开始探索。</p>
        {uploadControl}
      </div>

      {error && <p className="shelf-error">{error}</p>}

      {isLoading ? (
        <div className="shelf-empty">
          <Loader2 className="animate-spin" />
        </div>
      ) : documents.length === 0 ? (
        <div className="shelf-empty">档案库还是空的。先上传一份 PDF。</div>
      ) : (
        <div className="bookshelf">
          {documents.map((document) => (
            <article className="shelf-book" key={document.id}>
              <button
                type="button"
                className="book"
                onClick={() => setReading(document)}
                title={document.name}
              >
                <span className="book-3d">
                  <span className="book-pages" />
                  <span className="book-board">
                    <span className="book-spine" />
                    <span className="book-cover">
                      <span className="book-title">{coverTitle(document.name)}</span>
                      <span className="book-meta">{document.pages} 页</span>
                    </span>
                  </span>
                </span>
              </button>
              <div className="book-actions">
                <button type="button" className="btn" onClick={() => setReading(document)}>
                  阅读
                </button>
                <button type="button" className="btn" onClick={() => onExplore(document)}>
                  星球探索
                </button>
                <button
                  type="button"
                  className="btn book-delete"
                  onClick={() => handleDelete(document)}
                  aria-label={`移除 ${document.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};
