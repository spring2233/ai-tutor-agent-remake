import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  Send,
  Upload,
  File as FileIcon,
  Search,
  CheckCircle2,
  Plus,
  MessageSquare,
  Trash2,
  Library,
} from 'lucide-react';
import { Bookshelf, type LibraryDocument } from '../library/Bookshelf';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  source?: string;
  confidence?: number;
  source_type?: 'RAG' | 'WEB' | 'NONE';
  trace?: string[];
  metrics?: {
    total_ms?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  documentId: string | null;
  documentName?: string | null;
  createdAt: string;
  updatedAt: string;
}

const CHAT_HISTORY_KEY = 'ai-tutor-chat-history-v2';
const CURRENT_DOCUMENT_KEY = 'ai-tutor-current-document-v2';
const CURRENT_DOCUMENT_NAME_KEY = 'ai-tutor-current-document-name-v2';

function formatDuration(totalMs?: number) {
  if (totalMs == null) {
    return '—';
  }
  if (totalMs < 1000) {
    return `${Math.round(totalMs)} ms`;
  }
  return `${(totalMs / 1000).toFixed(1)} s`;
}

function formatTokens(metrics: NonNullable<Message['metrics']>) {
  const total = metrics.total_tokens ?? 0;
  const prompt = metrics.prompt_tokens ?? 0;
  const completion = metrics.completion_tokens ?? 0;
  if (!total && !prompt && !completion) {
    return '用量不可用';
  }
  return `${total}（输入 ${prompt} / 输出 ${completion}）`;
}

export const ChatView = ({ embedded = false }: { embedded?: boolean }) => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [inChat, setInChat] = useState(embedded);
  const [libraryVersion, setLibraryVersion] = useState(0);

  /*
   * Restore the currently selected PDF immediately.
   * This survives navigation between features.
   */
  const [documentId, setDocumentId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CURRENT_DOCUMENT_KEY);
    } catch {
      return null;
    }
  });
  const [documentName, setDocumentName] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CURRENT_DOCUMENT_NAME_KEY);
    } catch {
      return null;
    }
  });

  const [chatHistory, setChatHistory] = useState<ChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // =========================================================
  // UTILITY
  // =========================================================

  const createChatId = () => {
    return (
      Date.now().toString() +
      '-' +
      Math.random().toString(36).substring(2, 10)
    );
  };

  const getHistoryFromStorage = (): ChatSession[] => {
    try {
      const raw = localStorage.getItem(CHAT_HISTORY_KEY);

      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);

      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error(
        'Error reading chat history:',
        error
      );

      return [];
    }
  };

  const saveHistoryToStorage = (
    history: ChatSession[]
  ) => {
    try {
      localStorage.setItem(
        CHAT_HISTORY_KEY,
        JSON.stringify(history)
      );
    } catch (error) {
      console.error(
        'Error saving chat history:',
        error
      );
    }
  };

  // =========================================================
  // LOAD HISTORY WHEN CHAT PAGE OPENS
  // =========================================================

  useEffect(() => {
    if (params.get('shelf') === '1') {
      setInChat(false);
    }
  }, [params]);

  useEffect(() => {
    const history = getHistoryFromStorage();

    setChatHistory(history);

    /*
     * IMPORTANT:
     *
     * We intentionally start with a NEW/FRESH chat
     * whenever the Chat page is opened.
     *
     * Old chats remain in Chat History.
     */
    setMessages([]);
    setCurrentChatId(null);

    /*
     * Restore the active PDF.
     */
    try {
      const savedDocument = localStorage.getItem(
        CURRENT_DOCUMENT_KEY
      );

      if (savedDocument) {
        setDocumentId(savedDocument);
      }
    } catch (error) {
      console.error(
        'Error restoring PDF:',
        error
      );
    }
  }, []);

  // =========================================================
  // SAVE CURRENT PDF
  // =========================================================

  useEffect(() => {
    try {
      if (documentId) {
        localStorage.setItem(
          CURRENT_DOCUMENT_KEY,
          documentId
        );
      }
    } catch (error) {
      console.error(
        'Error saving current PDF:',
        error
      );
    }
  }, [documentId]);

  // =========================================================
  // SCROLL
  // =========================================================

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({
      behavior: 'smooth',
    });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // =========================================================
  // SAVE CHAT DIRECTLY TO LOCAL STORAGE
  // =========================================================

  const persistChat = (
    chatId: string,
    chatMessages: Message[],
    chatDocumentId: string | null,
    chatDocumentName: string | null
  ) => {
    if (chatMessages.length === 0) {
      return;
    }

    try {
      const existingHistory =
        getHistoryFromStorage();

      const firstUserMessage =
        chatMessages.find(
          (message) =>
            message.role === 'user'
        );

      const title =
        firstUserMessage?.content
          ?.trim()
          .slice(0, 45) ||
        '新对话';

      const existingChat =
        existingHistory.find(
          (chat) => chat.id === chatId
        );

      const updatedChat: ChatSession = {
        id: chatId,
        title,
        messages: chatMessages,
        documentId: chatDocumentId,
        documentName: chatDocumentName,
        createdAt:
          existingChat?.createdAt ||
          new Date().toISOString(),
        updatedAt:
          new Date().toISOString(),
      };

      const updatedHistory =
        existingChat
          ? existingHistory.map(
              (chat) =>
                chat.id === chatId
                  ? updatedChat
                  : chat
            )
          : [
              updatedChat,
              ...existingHistory,
            ];

      /*
       * THIS IS THE IMPORTANT FIX.
       *
       * Save directly to localStorage immediately.
       * We don't depend on a later React state effect.
       */
      saveHistoryToStorage(
        updatedHistory
      );

      setChatHistory(
        updatedHistory
      );
    } catch (error) {
      console.error(
        'Error persisting chat:',
        error
      );
    }
  };

  // =========================================================
  // FILE UPLOAD
  // =========================================================

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file =
      e.target.files?.[0];

    if (!file) {
      return;
    }

    /*
     * Keep the actual uploaded file for the backend.
     */
    const formData =
      new FormData();

    formData.append(
      'file',
      file
    );

    try {
      const res =
        await fetch(
          '/api/upload',
          {
            method: 'POST',
            body: formData,
          }
        );

      const data =
        await res.json();

      if (res.ok) {
        const nextId = data.document_id || data.name;
        const nextName = data.name || nextId;
        setDocumentId(nextId);
        setDocumentName(nextName);
        localStorage.setItem(CURRENT_DOCUMENT_KEY, nextId);
        localStorage.setItem(CURRENT_DOCUMENT_NAME_KEY, nextName);
        setLibraryVersion((value) => value + 1);
      } else {
        alert(
          data.detail ||
            data.message ||
            '上传文件失败'
        );
      }
    } catch (error) {
      console.error(
        'Upload error:',
        error
      );

      alert(
        '上传文件时网络出错'
      );
    }

    /*
     * Allow the same file to be selected again.
     */
    e.target.value = '';
  };

  // =========================================================
  // SEND MESSAGE
  // =========================================================

  const handleSend = async (
    e?: React.FormEvent
  ) => {
    e?.preventDefault();

    if (
      !input.trim() ||
      isLoading
    ) {
      return;
    }

    const question =
      input.trim();

    /*
     * Create a chat ID only when
     * the user actually starts a conversation.
     */
    const chatId =
      currentChatId ||
      createChatId();

    if (!currentChatId) {
      setCurrentChatId(
        chatId
      );
    }

    const userMessage: Message = {
      role: 'user',
      content: question,
    };

    /*
     * Preserve previous messages for backend history.
     */
    const previousMessages =
      [...messages];

    /*
     * Immediately update UI.
     */
    const messagesAfterUser = [
      ...previousMessages,
      userMessage,
    ];

    setMessages(
      messagesAfterUser
    );

    /*
     * IMPORTANT:
     * Save the user message immediately.
     *
     * Even if the user navigates away before
     * the AI response finishes, the conversation
     * won't disappear.
     */
    persistChat(
      chatId,
      messagesAfterUser,
      documentId,
      documentName
    );

    setInput('');
    setIsLoading(true);

    try {
      const res =
        await fetch(
          '/api/chat',
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              question,
              chat_history:
                previousMessages,
              document_id:
                documentId,
            }),
          }
        );

      const data =
        await res.json();

      if (!res.ok) {
        throw new Error(
          data.detail ||
            data.message ||
            'Chat request failed'
        );
      }

      const assistantMessage: Message = {
        role: 'assistant',
        content:
          data.answer ||
          '抱歉，这次没能生成回答。',
        source:
          data.source,
        confidence:
          data.confidence,
        source_type:
          data.source_type,
        trace:
          data.trace,
        metrics:
          data.metrics,
      };

      const completeMessages = [
        ...messagesAfterUser,
        assistantMessage,
      ];

      setMessages(
        completeMessages
      );

      /*
       * Save complete conversation immediately.
       */
      persistChat(
        chatId,
        completeMessages,
        documentId,
        documentName
      );
    } catch (error) {
      console.error(
        'Chat error:',
        error
      );

      const errorMessage: Message = {
        role: 'assistant',
        content:
          '抱歉，处理你的请求时出错了。',
      };

      const completeMessages = [
        ...messagesAfterUser,
        errorMessage,
      ];

      setMessages(
        completeMessages
      );

      persistChat(
        chatId,
        completeMessages,
        documentId,
        documentName
      );
    } finally {
      setIsLoading(false);
    }
  };

  // =========================================================
  // NEW CHAT
  // =========================================================

  const handleNewChat = () => {
    setMessages([]);
    setInput('');
    setCurrentChatId(null);
    if (!embedded) {
      setInChat(false);
    }
  };

  const rememberDocument = (document: LibraryDocument) => {
    setDocumentId(document.id);
    setDocumentName(document.name);
    localStorage.setItem(CURRENT_DOCUMENT_KEY, document.id);
    localStorage.setItem(CURRENT_DOCUMENT_NAME_KEY, document.name);
  };

  const handleExploreFromShelf = (document: LibraryDocument) => {
    rememberDocument(document);
    navigate(`/quest?document=${document.id}`);
  };

  // =========================================================
  // RESTORE CHAT
  // =========================================================

  const handleRestoreChat = (
    chat: ChatSession
  ) => {
    setMessages(
      chat.messages || []
    );

    setCurrentChatId(
      chat.id
    );
    setInChat(true);

    setInput('');

    /*
     * Restore the PDF associated
     * with that conversation.
     */
    if (chat.documentId) {
      setDocumentId(
        chat.documentId
      );
      setDocumentName(chat.documentName || null);

      localStorage.setItem(
        CURRENT_DOCUMENT_KEY,
        chat.documentId
      );
      if (chat.documentName) {
        localStorage.setItem(
          CURRENT_DOCUMENT_NAME_KEY,
          chat.documentName
        );
      }
    } else {
      setDocumentId(null);
      setDocumentName(null);

      localStorage.removeItem(
        CURRENT_DOCUMENT_KEY
      );
      localStorage.removeItem(
        CURRENT_DOCUMENT_NAME_KEY
      );
    }
  };

  // =========================================================
  // DELETE CHAT
  // =========================================================

  const handleDeleteChat = (
    e: React.MouseEvent,
    chatId: string
  ) => {
    e.stopPropagation();

    const history =
      getHistoryFromStorage();

    const updatedHistory =
      history.filter(
        (chat) =>
          chat.id !== chatId
      );

    /*
     * Delete immediately from localStorage.
     */
    saveHistoryToStorage(
      updatedHistory
    );

    setChatHistory(
      updatedHistory
    );

    if (
      currentChatId ===
      chatId
    ) {
      setMessages([]);
      setCurrentChatId(
        null
      );
      if (!embedded) {
        setInChat(false);
      }
    }
  };

  // =========================================================
  // FORMAT DATE
  // =========================================================

  const formatDate = (
    dateString: string
  ) => {
    try {
      return new Date(
        dateString
      ).toLocaleString(
        'zh-CN',
        {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }
      );
    } catch {
      return '';
    }
  };

  return (
    <div className="chat-layout">
      <div className="chat-history-rail">
        <div className="chat-history-head">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleNewChat}
            style={{ width: '100%', justifyContent: 'center', fontSize: '0.85rem' }}
          >
            <Plus size={16} />
            新对话
          </button>
        </div>
        <div className="chat-history-label">对话记录</div>
        <div className="chat-history-list">
          {chatHistory.length === 0 ? (
            <div className="chat-history-empty">还没有历史对话。</div>
          ) : (
            chatHistory.map((chat) => (
              <div
                key={chat.id}
                className={`chat-history-item${currentChatId === chat.id ? ' active' : ''}`}
                onClick={() => handleRestoreChat(chat)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleRestoreChat(chat);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="chat-history-row">
                  <MessageSquare size={15} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="chat-history-title">{chat.title}</div>
                    <div className="chat-history-meta">{formatDate(chat.updatedAt)}</div>
                    {chat.documentId && (
                      <div className="chat-history-doc">{chat.documentName || chat.documentId}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="chat-history-delete"
                    onClick={(event) => handleDeleteChat(event, chat.id)}
                    title="删除对话"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {!inChat && !embedded ? (
        <div className="chat-shelf">
          <Bookshelf
            refreshToken={libraryVersion}
            onExplore={handleExploreFromShelf}
            onUploaded={() => setLibraryVersion((value) => value + 1)}
          />
        </div>
      ) : (
        <div className="chat-main">
          <div className="chat-toolbar">
            <div>
              <h2>AI 导师对话</h2>
              <p>
                {documentName || documentId
                  ? `基于 ${documentName || documentId}`
                  : '尚未载入文档，将使用网络搜索。'}
              </p>
            </div>
            <div className="chat-toolbar-actions">
              {embedded ? null : (
                <button type="button" className="btn" onClick={handleNewChat}>
                  <Library size={16} />
                  书架
                </button>
              )}
              <input
                type="file"
                id="file-upload"
                accept=".pdf"
                className="sr-only"
                onChange={handleFileUpload}
              />
              <label htmlFor="file-upload" className="btn btn-primary" style={{ cursor: 'pointer' }}>
                <Upload size={16} />
                上传 PDF
              </label>
            </div>
          </div>

          <div className="chat-thread">
            {messages.length === 0 ? (
              <div className="hero" style={{ textAlign: 'center', margin: '2rem' }}>
                <div className="eyebrow">对话</div>
                <h1>
                  问问 <span className="grad-text">这本书</span>
                </h1>
                <p style={{ margin: '1rem auto' }}>问题会基于你从书架打开的 PDF。</p>
                {documentId && (
                  <div className="chat-doc-chip">
                    <FileIcon size={14} />
                    {documentName || documentId}
                  </div>
                )}
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div key={idx} className={`chat-msg ${msg.role}`}>
                  <div className="chat-msg-role">{msg.role === 'user' ? '你' : '导师'}</div>
                  <div className="chat-msg-body">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                  {msg.role === 'assistant' && msg.source_type && msg.source_type !== 'NONE' && (
                    <div className="chat-msg-meta">
                      {msg.source_type === 'RAG' ? (
                        <span className="chat-chip doc">
                          <FileIcon size={12} />
                          {msg.source}
                        </span>
                      ) : (
                        <span className="chat-chip web">
                          <Search size={12} />
                          网络搜索
                        </span>
                      )}
                      {msg.metrics && (
                        <span className="chat-chip quiet">
                          {formatDuration(msg.metrics.total_ms)} · {formatTokens(msg.metrics)}
                        </span>
                      )}
                      {msg.confidence !== undefined && (
                        <span className="chat-chip quiet">
                          <CheckCircle2 size={12} />
                          置信度： {msg.confidence}%
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
            {isLoading && <div className="chat-thinking">导师正在思考…</div>}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSend} className="chat-composer">
            <input
              type="text"
              className="input"
              placeholder="就这份学习材料提问…"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={isLoading}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-primary" disabled={isLoading || !input.trim()}>
              <Send size={18} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
