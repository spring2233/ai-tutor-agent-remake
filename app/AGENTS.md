# 后端

改 `app/`、`tests/` 或问答/上传/测验接口时读本文件。闯关 JSON 形状和战斗规则见 `frontend/src/components/quest/AGENTS.md`。前端壳子怎么摆不由本文件规定；首页功能块布局未确认，后端不要为了迁就旧侧栏去增删接口。

## 入口

- `app/api/main.py`：FastAPI，CORS 全开，把请求转给 `app/ui/backend.py`。
- `app/ui/backend.py`：上传、问答、测验、闪卡、学习计划、思维导图、记忆配对、闯关生成。
- `app/graph.py`：检索 → 评分 → 生成；评分为 `none`（或没有 `document_id`）才走 MCP 搜索。
- `app/llm_factory.py`：有 `DASHSCOPE_API_KEY` 用 DashScope Qwen（OpenAI 兼容接口）。对话、测验、计划、闯关共用。输出上限读 `LLM_MAX_TOKENS`（默认 16384）。Groq 不是启动条件。
- `app/rag/config.py`：只从本目录 `.env` 读配置。
- `app/rag/embeddings.py`：本地 `models/all-MiniLM-L6-v2`，离线。
- `app/rag/library.py`：`uploads/` 与 `uploads/catalog.json`，文档 id 为 12 位，不用文件名当 id。知识地图在 `uploads/{id}.units.json`。
- `app/rag/chunker.py`：按标题/编号小节和段落切块，目标 1500–3000 字、重叠约 200，尽量不在公式中间断开。上传时按块抽知识单元（概念、完整陈述、前置、人话）。
- `POST /api/zones`：有知识地图时用单元列表生成区域；旧文档回退到 chunk 抽样。`/api/chat` 仍检索结构切块。
- `app/metrics.py`：问答耗时和 token，经 `/api/chat` 的 `metrics` 回给聊天页。

`mcp_server/` 是独立进程，不在本包启动。

## HTTP

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/api/upload` | 解析并入库 PDF |
| GET | `/api/documents` | 书架列表 |
| GET | `/api/documents/{id}/file` | 预览 PDF |
| DELETE | `/api/documents/{id}` | 删除记录与文件 |
| POST | `/api/chat` | 问答（LangGraph） |
| POST | `/api/quiz` | 测验 |
| POST | `/api/flashcards` | 闪卡 |
| POST | `/api/flashcards/submit` | SM-2 间隔 |
| POST | `/api/study-plan` 及 session/progress | 学习计划 |
| POST | `/api/mindmap` | 思维导图 mermaid |
| POST | `/api/games/memory` | 记忆配对词对 |
| POST | `/api/quests` | 按 `document_id` 生成闯关 |
| POST | `/api/zones` | 星球地表 4–6 个知识区域（含 `intel` 扫描档案、守门人 `terms` / `decoyTerm`、每区 3~4 组递进 `gates` 双子光门 `truth`/`trap`/`probe`/可选 `note`；`stage` 为 `first` 时只生成星球简介 + `outline` 规划 + 第 1 区，`rest` 时按传入的 `outline` 与 `start` 补齐其余区域（id 接续），默认 `full` 一次生成；路由是同步 `def`，模型调用在线程池里，不阻塞并发的 `/api/chat`；`_normalize_gates` 丢弃字数不对称或超范围的组，缺 gates 的区域仍有效） |
| POST | `/api/zones/feynman` | 守门人按要点给费曼解释打共鸣度 |

## 问答图

1. `retrieve`：无 `document_id` 则空上下文，不抛错。
2. `grade`：输出 `full` / `partial` / `none`。必须能解析 Markdown 代码围栏里的 JSON。
3. 路由：`full`、`partial` 直接生成；只有 `none` 才 `web_search` 再生成。
4. 生成提示：网页内容带 `Web result` 前缀，不能写成文档原话。

相关文件：`app/prompts/grader_prompt.py`、`generator_prompt.py`、`mcp_server/web_search_node.py`。

## 其它生成

测验、闪卡、记忆配对、闯关都从文档 chunk 抽样后走 LLM，再用 `_extract_json_from_response` 抽 JSON。闯关规范化在 `backend._normalize_quest`：3–5 个区域、每区 2 题、首领 5 题，类型归一成 `research` / `teaching` / `exam`。测例：`tests/test_quest.py`、`tests/test_library.py`、`tests/test_graph.py`。

## 改后端时

- 不要把 Groq 写回启动必需。
- 不要让 `partial` 去搜索。
- 密钥、代理、模型路径只写变量名和路径。
- 行为变了就更新本文件或闯关 `AGENTS.md`，并改 `PROJECT_MEMORY.md` 快照。
