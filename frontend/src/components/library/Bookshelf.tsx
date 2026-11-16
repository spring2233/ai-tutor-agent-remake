import { useEffect, useState, type ChangeEvent } from 'react';
import { Loader2, Swords, Trash2, Upload } from 'lucide-react';
import { apiErrorMessage } from '../../api/httpError';

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

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    setIsUploading(true);
    setError('');
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || '上传失败');
      }
      onUploaded(
        data.document_id
          ? { id: data.document_id as string, name: (data.name as string) || file.name }
          : undefined,
      );
      await loadDocuments();
    } catch (err) {
      setError(apiErrorMessage(err, '上传失败'));
    } finally {
      setIsUploading(false);
    }
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
        {isUploading ? '正在索引…' : '上传 PDF'}
      </label>
    </div>
  );

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
              闯关
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
        <div className="eyebrow">{variant === 'upload' ? '上传' : '星图档案'}</div>
        <h1>
          {variant === 'upload' ? (
            <>把 PDF 放进这条<span className="grad-text">星图</span></>
          ) : (
            <>文档停泊在这条<span className="grad-text">星图</span></>
          )}
        </h1>
        <p>
          {variant === 'upload'
            ? '选择一份 PDF，索引完成后会出现在「查看已有内容」里。'
            : '打开一份阅读，或从这份材料开始闯关。'}
        </p>
        {uploadControl}
      </div>

      {error && <p className="shelf-error">{error}</p>}

      {variant === 'upload' ? null : isLoading ? (
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
                  闯关
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
