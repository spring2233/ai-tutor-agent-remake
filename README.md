# AI-Tutor-Agent

上传 PDF 后，可以用自然语言提问，并生成闪卡、测验、思维导图和学习计划。检索、相关性评分和回答由 LangGraph 串起来。文档评分为 `full` 或 `partial` 时，回答以 PDF 为准；只有评分为 `none` 时，才通过 MCP 用 DuckDuckGo 搜索网页。网页片段会标成 `Web result`，不会被当成文档原文。

聊天回答会显示本次耗时，以及评分和生成两次调用合计的 token。

前端是 React 单页应用。开发时浏览器访问 Vite，页面里的 `/api` 请求由 Vite 转发到本机 FastAPI。只打开前端页面不够，后端和搜索服务也要在同一台机器上运行。

---

## 功能

- 上传 PDF，切块后用本地嵌入模型写入 ChromaDB
- 基于文档的问答；文档覆盖不了问题时再搜索网页
- 书架中保留已上传的 PDF
- 思维导图（Mermaid）
- 闪卡与间隔重复（SM-2）、测验
- 多节学习计划与进度
- 根据当前文档生成记忆配对
- 四套界面主题

默认对话模型是 DashScope 的 Qwen（OpenAI 兼容接口）。`.env` 需要 `DASHSCOPE_API_KEY` 和 `DASHSCOPE_BASE_URL`。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 语言 | Python 3.12、TypeScript |
| 对话模型 | DashScope Qwen（默认 `qwen3.7-plus`） |
| 嵌入模型 | 本地 `sentence-transformers/all-MiniLM-L6-v2` |
| 代理框架 | LangChain、LangGraph |
| 向量库 | ChromaDB |
| 网页搜索 | DuckDuckGo，经 FastMCP |
| 后端 | FastAPI、Uvicorn |
| 前端 | React 19、Vite、TypeScript |

---

## 克隆之后不会带上的文件

这些路径在 `.gitignore` 里，需要每台机器自己准备：

| 路径 | 内容 |
| --- | --- |
| `.env` | API key。不要提交，也不要转发别人的密钥 |
| `models/` | 嵌入模型，约 90MB |
| `uploads/` | 上传的 PDF |
| `chroma_db/` | 向量索引 |
| `.venv/`、`frontend/node_modules/` | 本地依赖 |

---

## 环境要求

- 官方 Python 3.12（[python.org](https://www.python.org/downloads/)）。3.11 装不了 `requirements.txt` 里的 `numpy==2.5.1`。不要用 MSYS2 / UCRT64 的 `python`，它的虚拟环境布局和平台标记都和 Windows 轮子不兼容。
- Node.js 20 或更新版本（当前开发机用的是 Node.js 24 LTS）。
- 能访问 DashScope 兼容接口的网络。安装 PyTorch 和前端依赖时还需要能下载对应的包。

Windows 上请用 PowerShell。下面的 Windows 命令都按 PowerShell 书写。

---

## 安装

在仓库根目录 `AI-Tutor-Agent` 执行。

### 1. Python 虚拟环境

Windows：

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

如果执行策略拦住激活脚本，先在当前窗口执行 `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`。激活成功后，提示符前面会出现 `(.venv)`。

macOS / Linux：

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

`pip install` 会安装 PyTorch，第一次可能要几分钟。确认解释器不是系统里另一个 Python：

```powershell
python -c "import sys; print(sys.executable)"
```

路径应落在本仓库的 `.venv` 里。

只有在 `.env` 里填写 `GROQ_API_KEY` 时，才需要额外安装：

```powershell
pip install langchain-groq
```

### 2. 环境变量

```powershell
copy .env.example .env
```

macOS / Linux 用 `cp .env.example .env`。

至少填入 DashScope 配置：

```env
DASHSCOPE_API_KEY=你的_key
DASHSCOPE_BASE_URL=兼容模式_base_url
DASHSCOPE_MODEL=qwen3.7-plus
```

不要把本机代理写进准备提交的文件。如果这台机器必须通过本地代理才能访问模型服务，再在自己的 `.env` 里增加 `HTTP_PROXY`、`HTTPS_PROXY`，并用 `NO_PROXY=localhost,127.0.0.1` 避开本机服务。

### 3. 嵌入模型

程序读取仓库根目录下的 `models/all-MiniLM-L6-v2`。目录不存在时，上传 PDF 会失败。需要这些文件：

```text
models/all-MiniLM-L6-v2/
├── config.json
├── config_sentence_transformers.json
├── modules.json
├── sentence_bert_config.json
├── model.safetensors
├── tokenizer.json
├── tokenizer_config.json
├── special_tokens_map.json
├── vocab.txt
└── 1_Pooling/config.json
```

模型页面：<https://hf-mirror.com/sentence-transformers/all-MiniLM-L6-v2>

最大的文件是 `model.safetensors`。`1_Pooling/config.json` 必须放在 `1_Pooling` 子目录里。下载时关闭 Hugging Face 的 Xet 通道，否则镜像可能返回 401：

```powershell
$env:HF_ENDPOINT = "https://hf-mirror.com"
$env:HF_HUB_DISABLE_XET = "1"
.\.venv\Scripts\python.exe -c "from huggingface_hub import snapshot_download; snapshot_download('sentence-transformers/all-MiniLM-L6-v2', local_dir='models/all-MiniLM-L6-v2')"
```

模型已经在 `models/all-MiniLM-L6-v2` 之后，可以在 `.env` 里设置 `HF_HUB_OFFLINE=1`，避免运行时再访问 Hugging Face。

### 4. 前端依赖

```powershell
cd frontend
npm install
cd ..
```

新开的终端如果提示找不到 `npm`，把 `C:\Program Files\nodejs` 加入当前窗口的 `PATH`，或重新打开终端。Cursor 里在安装 Node 之前已经打开的终端不会自动看到新的 `PATH`。

---

## 运行

开三个终端，都先进入 `AI-Tutor-Agent`。跑 Python 的两个终端要先激活虚拟环境。

终端 1，搜索服务：

```powershell
.\.venv\Scripts\Activate.ps1
python -m mcp_server.server
```

监听 `http://127.0.0.1:8001/mcp`。

终端 2，后端：

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn app.api.main:app --reload --port 8000
```

看到 `Application startup complete` 后，接口文档在 `http://127.0.0.1:8000/docs`。直接打开 `http://127.0.0.1:8000/` 会返回 404，这是正常的，页面不由这个端口提供。

终端 3，前端：

```powershell
cd frontend
npm run dev
```

浏览器打开 **http://localhost:5173/** 。三个终端都要保持运行。

---

## 目录

```text
AI-Tutor-Agent/
├── app/
│   ├── api/main.py           # FastAPI
│   ├── graph.py              # 检索、评分、生成、搜索路由
│   ├── llm_factory.py        # DashScope Qwen / 可选 Groq
│   ├── metrics.py            # 耗时与 token
│   ├── prompts/
│   ├── rag/                  # 解析、切块、嵌入、检索、书架
│   ├── study_plan/
│   └── ui/backend.py
├── frontend/src/components/  # chat、studyplan、flashcards、mindmap、game、library、intro
├── mcp_server/               # DuckDuckGo 搜索
├── models/                   # 本地嵌入模型（不提交）
├── uploads/                  # 上传的 PDF（不提交）
├── requirements.txt
└── .env.example
```

---

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/upload` | 上传 PDF |
| `GET` | `/api/documents` | 书架列表 |
| `GET` | `/api/documents/{id}/file` | 打开已保存的 PDF |
| `DELETE` | `/api/documents/{id}` | 删除文档 |
| `POST` | `/api/chat` | 提问 |
| `POST` | `/api/flashcards` | 生成闪卡 |
| `POST` | `/api/flashcards/submit` | 提交闪卡复习结果 |
| `POST` | `/api/quiz` | 生成测验 |
| `POST` | `/api/study-plan` | 生成学习计划 |
| `POST` | `/api/study-plan/session/start` | 开始一节 |
| `POST` | `/api/study-plan/session/complete` | 完成一节 |
| `POST` | `/api/study-plan/progress` | 查看进度 |
| `POST` | `/api/mindmap` | 生成思维导图 |
| `POST` | `/api/games/memory` | 按当前文档生成记忆配对 |

---

## 问答流程

1. 前端把 PDF 传到 `/api/upload`。
2. 后端解析、切块、嵌入，写入 ChromaDB，并把原文件留在 `uploads/`。
3. 提问时先按文档检索，再让模型判断相关性。
4. `full` 或 `partial`：只用文档生成回答。
5. `none`：MCP 搜索网页，再生成回答，并标明来自网页。
6. 响应里的 `metrics` 包含总耗时和 token 用量。

---

## 常见问题

- PowerShell 里不要运行 `.venv\Scripts\activate`。Windows 官方 Python 的脚本是 `.\.venv\Scripts\Activate.ps1`。
- `uvicorn` 或 `npm` 找不到：对应终端没有激活 `.venv`，或者终端还在使用安装 Node 之前的 `PATH`。
- 上传时报缺少 `sentence_transformers`：在已激活的环境里重新执行 `pip install -r requirements.txt`。
- 上传或提问时去连 `huggingface.co`：模型目录不完整，或没有设置 `HF_HUB_OFFLINE=1`。
- 页面一直停在 thinking：后端没有启动，或当前网络访问不了 DashScope。看后端终端里的报错。

这个仓库目前适合 clone 后在本机运行。GitHub Pages 只能托管静态页面，不能代替 FastAPI、Chroma 和 MCP。

---

## License

This project is developed for educational and research purposes as part of the Dell Technologies GSOP'26.
