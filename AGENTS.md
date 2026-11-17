# AGENTS.md

新对话先读本文件，再读 `PROJECT_MEMORY.md` 的「当前快照」。产品代码在本目录。`README.md` 可能落后于代码，不能当作现状。

模块细节不写在本文件。涉及对应任务时再读：

| 任务 | 先读 |
| --- | --- |
| 前端页面、动效、交互、素材 | `frontend/AGENTS.md` |
| API、RAG、问答图、上传与测验 | `app/AGENTS.md` |
| 闯关生成、关卡结构、战斗页 | `frontend/src/components/quest/AGENTS.md` |

网页搜索服务见 `mcp_server/server.py`（端口 8001），不要和 uvicorn（8000）搞混。

## 项目背景

本地可运行的 AI Tutor：上传 PDF，用 LangGraph 做检索、相关性评分和回答；文档覆盖不了问题时才走 DuckDuckGo（MCP）。首页是峡谷 3D 上的「上传内容 / 查看已有内容」。查看档案进入 `/chat` 星图（PDF 星球），选中星球后只有两个模式：星球探索（`/explore`，迷雾解锁 + 守门人费曼对线）和知识问答（`/ask`）。闪卡、记忆配对、经典闯关不在界面上。

目标用途（用户已说明）：黑客松报名项目。公网演示地址还没有。

## 运行方式

官方 Python 3.12 的 `.venv`，三个进程：`python -m mcp_server.server`、`uvicorn app.api.main:app --reload --port 8000`、`frontend` 里 `npm run dev`（5173，`/api` 代理到 8000）。Windows 先执行 `.\.venv\Scripts\Activate.ps1`。密钥只认本目录 `.env`。

## 授权边界

- 不把 API key、代理地址或 `.env` 内容写进文档、提交或聊天摘录。
- 不改 git config，不强制推送，不跳过 hooks。用户没明确要求时不提交、不部署。
- 本文件只做入口和边界。改产品代码、素材或部署配置需要单独的任务。
- 嵌入模型目录 `models/` 和上传的 PDF 不进 Git。根目录散落的 `boss.png`、角色图等未跟踪副本不是运行时路径，正式素材在 `frontend/public/`。

## 修改规范

- 只改任务涉及的文件。README 与代码冲突时，以代码和 `PROJECT_MEMORY.md` 里「已核实」的结论为准，并在改动后更新记忆。
- 对话、测验、学习计划、闯关生成共用 `app/llm_factory.py`（默认 DashScope Qwen）。不要把 Groq 写成启动必需条件。
- 文档评分为 `full` 或 `partial` 时留在文档里；只有 `none` 才搜索。网页片段必须带 `Web result` 前缀。

## 完成标准

- 改动能在当前三个本地进程里复现，或说明哪一步没跑。
- 问答改动要能区分「来自上传文档」和「来自网页」。
- 前端改动要核对相关路由，不只看一张截图。
- 涉及密钥、模型路径或代理的改动，用变量名和文件路径描述，不粘贴秘密值。

## 何时更新这些说明

入口、边界或完成标准变了才改本文件。前端/后端/闯关的行为变了，改对应模块的 `AGENTS.md`，并在 `PROJECT_MEMORY.md` 留一条带来源的记录。
