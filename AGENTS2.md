# AGENTS.md

新对话先读本文件，再读 `PROJECT_MEMORY.md` 的「当前快照」。产品代码在本目录（`AI-Tutor-Agent`）。仓库根的 `README.md` 已落后于代码，不能当作现状。

## 项目背景

本地可运行的 AI Tutor：上传 PDF，用 LangGraph 做检索、相关性评分和回答；文档覆盖不了问题时才走 DuckDuckGo（MCP）。另外有学习计划、闪卡、测验、思维导图。前端还有书架、开场介绍、记忆配对和布局编辑页，这些界面的产品决定来源尚未由用户逐项确认。

目标用途（用户已说明）：作为黑客松报名项目。公网演示地址还没有。

## 关键目录

| 路径 | 作用 |
| --- | --- |
| `app/api/main.py` | FastAPI 入口 |
| `app/ui/backend.py` | 上传、问答、测验、学习计划、记忆配对 |
| `app/graph.py` | 检索 → 评分 → 生成，或在 `none` 时上网搜索 |
| `app/llm_factory.py` | 有 DashScope key 用 Qwen；Groq 不是启动条件 |
| `app/rag/config.py` | 从本目录 `.env` 读配置 |
| `app/rag/embeddings.py` | 本地 `models/all-MiniLM-L6-v2` |
| `app/rag/library.py` | `uploads/` 里的 PDF 和 `catalog.json` |
| `frontend/src/App.tsx` | 路由与侧栏 |
| `frontend/src/components/chat/ChatView.tsx` | 问答，含耗时和 token |
| `mcp_server/server.py` | 搜索服务，端口 8001 |

## 开始工作

1. 读 `PROJECT_MEMORY.md` 的当前快照、已确认决定、待验收和待确认。
2. 需要行为细节时再读对应源码，不要用 README 的目录树或 Python 3.13 说明覆盖现状。
3. 运行方式以快照为准：官方 Python 3.12 的 `.venv`，三个进程（MCP、uvicorn、`frontend` 的 `npm run dev`）。

## 授权边界

- 不把 API key、代理地址或 `.env` 内容写进文档、提交或聊天摘录。密钥只放 `AI-Tutor-Agent/.env`。
- 不改 git config，不强制推送，不跳过 hooks。用户没明确要求时不提交、不部署。
- 本文件和 `PROJECT_MEMORY.md` 只记录项目记忆。改产品代码、素材或部署配置需要单独的任务。
- 嵌入模型目录 `models/` 和上传的 PDF 不进 Git。

## 修改规范

- 只改任务涉及的文件。README 与代码冲突时，以代码和 `PROJECT_MEMORY.md` 里「已核实」的结论为准，并在改动后更新记忆。
- 对话、测验、学习计划共用 `app/llm_factory.py`。不要再把 Groq 写成启动必需条件。
- 评分结果要能解析带 Markdown 代码围栏的 JSON。文档评分为 `full` 或 `partial` 时留在文档里；只有 `none` 才搜索。
- 网页片段必须带 `Web result` 前缀，不能写成文档原话。

## 完成标准

- 改动能在当前三个本地进程里复现，或说明哪一步没跑。
- 问答改动要能区分「来自上传文档」和「来自网页」。
- 涉及密钥、模型路径或代理的改动，用变量名和文件路径描述，不粘贴秘密值。

## 何时更新项目记忆

出现新的已确认决定、验收结果、失效的旧结论，或运行方式变化时，更新 `PROJECT_MEMORY.md`：改当前快照和对应结论，把被取代的旧记录标为失效，并在制作历史里留一条带来源的记录。本文件只在入口、边界或完成标准变化时改。
