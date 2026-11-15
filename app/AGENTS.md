# 后端

改 `app/`、`tests/` 或问答/上传/测验接口时读本文件。闯关 JSON 形状和战斗规则见 `frontend/src/components/quest/AGENTS.md`。前端壳子怎么摆不由本文件规定；首页功能块布局未确认，后端不要为了迁就旧侧栏去增删接口。

## 入口

- `app/api/main.py`：FastAPI，CORS 全开，把请求转给 `app/ui/backend.py`。
- `app/ui/backend.py`：上传、问答、测验、闪卡、学习计划、思维导图、记忆配对、闯关生成。
- `app/graph.py`：检索 → 评分 → 生成；评分为 `none`（或没有 `document_id`）才走 MCP 搜索。
- `app/llm_factory.py`：有 `GROQ_API_KEY` 用 Groq，否则 Gemini。对话、测验、计划、闯关共用，Groq 不是启动条件。
- `app/rag/config.py`：只从本目录 `.env` 读配置。
- `app/rag/embeddings.py`：本地 `models/all-MiniLM-L6-v2`，离线。
- `app/rag/library.py`：`uploads/` 与 `uploads/catalog.json`，文档 id 为 12 位，不用文件名当 id。
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
