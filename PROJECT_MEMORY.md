# PROJECT_MEMORY.md

状态词：`已确认` 是用户明确说过或用后续操作接受的做法；`已核实` 是 2026-10-18 对照当前文件得到的事实；`已制作待验收` 是代码已写上、用户还没确认效果；`AI 建议` 尚未被采纳；`待确认` 不能从文件或对话核实。较旧的「当前状态」若与后文冲突，以后文为准。

## 当前快照

- 产品目录：`AI-Tutor-Agent`。Git 仓库在这一层，不在上一级 `new1`。来源：目录与 `.git`，状态：已核实。
- 给别人 clone 后本地运行的步骤写在 `README.md`（2026-10-18 已按当前代码重写）。状态：已制作。一键启动脚本和公网页面仍未做。
- 解释器：`.venv` 为 Python 3.12.10。README 写的 Python 3.13 已过时。来源：`.venv` 与 `README.md`，状态：已核实。
- 三个本地进程：`python -m mcp_server.server`（8001）、`uvicorn app.api.main:app --reload --port 8000`、`frontend` 里 `npm run dev`（5173，把 `/api` 代理到 8000）。来源：`README.md`、`frontend/vite.config.ts`、`mcp_server/server.py`，状态：已核实。Windows 上要先激活 `.venv\Scripts\Activate.ps1`；本机官方 Python 的 venv 在 `Scripts`，MSYS2 的 Python 会做成 `bin`，不能用来建环境。
- 密钥文件：只认 `AI-Tutor-Agent/.env`。上一级 `new1/.env` 不会被后端读取。来源：`app/rag/config.py` 的 `env_file=".env"`，以及 2026-10-16 启动失败，状态：已确认。
- 当前 `.env` 含这些变量名（不记录值）：`GOOGLE_API_KEY`、`HF_ENDPOINT`、`HF_HUB_DISABLE_XET`、`HF_HUB_OFFLINE`、`HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`。没有 `GROQ_API_KEY`。来源：2026-10-18 只读取变量名，状态：已核实。
- 对话模型：`gemini-3.6-flash`。有 Groq key 时 `app/llm_factory.py` 会优先用 Groq。来源：`app/rag/config.py`，状态：已核实。
- 嵌入模型：本地目录 `models/all-MiniLM-L6-v2`，离线（`HF_HUB_OFFLINE=1`）。来源：`app/rag/config.py`、`app/rag/embeddings.py`，状态：已核实。权重文件存在。
- 问答路由：`full` 和 `partial` 用文档生成；`none` 才 MCP 搜索。评分 JSON 允许包在 Markdown 代码围栏里。来源：`app/graph.py`，状态：已制作；用户在 2026-10-17 认为改后的领域随机化摘要「比较准确」，状态：该次回答已确认，后续提问未再验收。
- 回答用量：`/api/chat` 的 `metrics` 含 `total_ms` 和 prompt/completion/total tokens；聊天页在助手消息下显示。来源：`app/metrics.py`、`frontend/src/components/chat/ChatView.tsx`，状态：已制作待验收。
- 上传文档现在用 12 位 id 存在 `uploads/` 和 `uploads/catalog.json`，不再用文件名当 id。来源：`app/rag/library.py`、`app/ui/backend.py`，状态：已核实。旧的 Chroma 记录是否还在，本轮未再查询，状态：待确认。
- 前端：`/` 峡谷 3D 上叠「上传内容 / 查看已有内容」；`/?panel=` 切浮层且不卸载场景。问答、闪卡、记忆配对已离开主路由。`/quest` 才换 `arena` 战场 3D。`/layout` 仍独立。来源：2026-11-16 浮层档案，状态：已制作待验收。
- Agent 说明：根目录 `AGENTS.md` 只做入口；细节在 `frontend/AGENTS.md`、`app/AGENTS.md`、`frontend/src/components/quest/AGENTS.md`。`AGENTS2.md` 不会被自动加载。来源：2026-11-15 整理，状态：已制作。

## 已确认决定

1. 用 Google AI Studio 的 key 跑通项目，不把 Groq 当作启动条件。原因：用户只有 Gemini key，学习计划和测验原先在导入时强制 Groq。状态：已确认（2026-10-16）。实现：`app/llm_factory.py`。旧决定「测验和学习计划只能用 Groq」失效。
2. 密钥放在 `AI-Tutor-Agent/.env` 的 `GOOGLE_API_KEY`。放在 `new1/.env` 无效。状态：已确认。
3. 嵌入模型改走本地文件，不在运行时访问 `huggingface.co`。原因：直连超时；镜像的 Xet 通道返回 401。用户自行下载了 `model.safetensors`，配置文件由缓存补齐。状态：已确认（2026-10-16）。旧决定「运行时从 Hugging Face 拉取 `sentence-transformers/all-MiniLM-L6-v2`」失效。
4. 文档能回答时不要改去网页。原因：评分被代码围栏包住，被误判成 `none`，网页结果盖过了论文。状态：已确认问题；路由修复后的一次摘要被用户认为比较准确（2026-10-17）。
5. 回答要显示耗时和 token。状态：用户已提出要求（2026-10-17）。界面是否满意仍待验收。

## AI 建议（未采纳，不要当成决定）

- 把检索路径画在回答旁边，作为黑客松演示重点。
- 用仓库里的 `test_data/research_report.pdf` 做一键示例。该文件内容是量子计算，不是用户实际上传的论文。
- 侧栏改成赛题名称。
- 部署公网地址，并改掉 Vite 里写死的 `localhost:8000`。用户说过报名可能需要项目链接，但没有选定托管方式。

## 已制作但待验收

- 聊天回答下的耗时和 token 标签。token 是评分与生成两次调用之和。用户尚未回复是否看到。
- 生成提示要求网页内容带 `Web result`，且不能把网页说成文档内容。来源：`app/prompts/generator_prompt.py`、`mcp_server/web_search_node.py`。只验收过一次主题摘要，没有验收「文档里没有的问题」这条路径。
- `requirements.txt` 增加 `sentence-transformers==6.1.0`。`langchain-groq` 仍未写入该文件；当前 `.env` 没有 Groq key，所以启动不导入它。

## 踩过的坑

- PowerShell 不能用 `.venv\Scripts\activate`。官方 CPython 用 `.\.venv\Scripts\Activate.ps1`。MSYS2 UCRT64 Python 会建出 Unix 布局 `bin\`，且平台标记不是 `win_amd64`，装不了 Chroma 轮子。状态：已确认。
- Python 3.11 装不了锁死的 `numpy==2.5.1`（需要 ≥3.12）。本机后来安装了官方 Python 3.12.10。状态：已确认。
- `npm` / `uvicorn` 找不到，通常是新终端没激活 venv，或 Cursor 还拿着安装 Node 之前的 PATH。Node 安装在 `C:\Program Files\nodejs`。状态：已确认。
- `GET /` 和 `GET /json/version` 的 404 不是后端崩溃。页面在 5173，接口文档在 `http://127.0.0.1:8000/docs`。状态：已确认。
- Windows 系统代理不会自动进入已启动的 Python。当时注册表代理是 `127.0.0.1:7897`，已写入 `.env` 的 `HTTP_PROXY` / `HTTPS_PROXY`，并用 `NO_PROXY` 排除本机。代理端口是否仍然有效：待确认。
- Gemini 曾返回 503（模型繁忙），客户端重试后 200。不是密钥错误。状态：已核实（2026-10-17 日志）。
- 文件名和正文可能不一致。2026-10-17 的 Chroma 里，一条记录的 `document_id` 像 admittance-control 论文文件名，抽取出的正文标题是 *Domain Randomization for Transferring Deep Neural Networks from Simulation to the Real World*。这不能再当成「现在库里只有这一条」；当时用户要求不要再检索其他 PDF。状态：历史事实，当前库内容待确认。

## 下一步边界

- 不把 `new1/.env` 当成配置来源。
- 不把 README 里的三端目录树、Python 3.13、或「partial 也去搜索」写成当前行为。
- 不把量子计算示例 PDF 说成用户的论文。用户确认过的主题是领域随机化（模拟到现实）。
- 未要求时不部署、不提交、不把模型或 PDF 放进 Git。
- 首页是深空英雄页 + 顶栏 HUD。不要把已删除的侧栏功能块加回去。

## 仍待确认

- 黑客松要交的是 Git 仓库地址还是可打开的演示地址，以及托管平台。
- 代理 `127.0.0.1:7897` 现在是否还开着。
- token 与耗时显示是否符合预期。
- 书架、记忆配对、BookIntro、LayoutEditor 是否算本次报名范围，由谁加入。
- `uploads/catalog.json` 里现在有哪些文档。
- `gemini-3.6-flash` 是否要换成更稳的模型名。SDK 会忽略该模型的 temperature，这只是警告，不是失败。

## 制作历史

1. 2026-10-16，对话：查清运行方式、密钥位置和黑客松可展示点。来源：用户提问。状态：说明已给出；公网链接未做。
2. 2026-10-16，环境：弃用 MSYS2 Python，安装官方 Python 3.12.10 和 Node.js LTS 24.20.0，用 3.12 重建 `.venv`。来源：终端失败与后续安装。状态：已确认可用。
3. 2026-10-16，依赖：安装 `sentence-transformers` 6.1.0，并写入 `requirements.txt`。来源：上传报错。状态：已制作。
4. 2026-10-16，模型：`HF_ENDPOINT=https://hf-mirror.com`，关闭 Xet，最终改为本地目录并 `HF_HUB_OFFLINE=1`。自动镜像下载失败后由用户提供权重。状态：已确认。
5. 2026-10-16，LLM：新增 `app/llm_factory.py`，去掉学习计划对 `GROQ_API_KEY` 的强制检查。状态：已确认。
6. 2026-10-16，代理：把本机代理写入项目 `.env`。状态：当时生效；当前是否仍需要待确认。
7. 2026-10-17，正确性：评分解析代码围栏；`partial` 不再搜索；生成提示和网页前缀收紧。用户确认领域随机化摘要比较准确。状态：该次验收通过；完整回归未做。
8. 2026-10-17，用量：累计 token 并在聊天页显示总时间和 in/out token。状态：已制作待验收。
9. 2026-10-18，文档：新增本文件和 `AGENTS.md`。未改产品代码。状态：本轮交付。
10. 2026-10-18，文档：按当前运行方式重写 `README.md`。未加启动脚本，未做公网部署。状态：已制作。
11. 2026-11-15，文档：把根 `AGENTS.md` 收成入口，补前端/后端/闯关三份模块说明；快照中的前端路由改为与 `App.tsx` 一致。未改产品代码。状态：本轮交付。
12. 2026-11-15，文档：按用户意见，从 Agent 说明里拿掉首页功能块侧栏布局，避免后续把旧壳子当规范。未改产品代码。状态：本轮交付。
13. 2026-11-15，前端：深空英雄页 + 科幻 HUD 顶栏；删除 BookIntro 与侧栏；`three` 自研峡谷星花场景。状态：已制作待验收。
14. 2026-11-16，前端：压低鼠标中心过曝；首页两块玻璃浮层共用峡谷 3D；闯关才进 arena 场景。问答/闪卡/记忆配对移出主流程。状态：已制作待验收。
