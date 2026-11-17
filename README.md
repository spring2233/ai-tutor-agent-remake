# Starlore 知识星典

把一份 PDF 变成一颗可以降落、探索、点亮的星球。

上传文档后，Starlore 会把它切块、嵌入，并整理成一张知识地图。在深空星图里，每份 PDF 是一颗程序化生成的星球。选中星球后有两种学习方式：

- **星球探索**：降落到星球地表，驾驶滑翔器穿过「双生光门」判断真论断和领域误区，答对就让荒芜的花海一片片复苏；最后和守门人做费曼式对线。
- **知识问答**：用自然语言提问。LangGraph 先在文档里检索并评估相关性，文档答不了时才去网页搜索，网页内容会明确标为 `Web result`。

本项目在本机运行，需要同时启动后端、搜索服务和前端三个进程。

---

## 体验流程

1. **峡谷首页**（`/`）：全屏 3D 花谷。两张玻璃卡分别是「上传内容」和「查看已有内容」，第三张卡进入「03 星界鉴赏室」。
2. **星图**（`/chat`）：每份 PDF 是一颗星球，名字、配色和简介由文档内容推断。星球外观随学习进度分四档变化：未探索、探索中、部分完成、全部完成。
3. **星球探索**（`/explore`）：
   - 文档被拆成 4~6 个知识区域。第一个区域先生成，马上就能玩，其余区域在后台补齐并缓存在本地。
   - 「降落地表 · 穿门航行」：每章 3~4 道递进的光门（定义 → 机制 → 细节/误区 → 应用）。用 A/D、方向键、拖拽或点屏幕两侧换轨。答对释放复苏冲击波，连击越高波纹越大；答错由守门人反问点拨，并把这道题排到本章末尾重来。
   - 每章通关会弹出「章节知识星碑」，总结这一章的核心结论。
   - 同步率到 100% 时整颗星球绽放。之后可以收录进鉴赏室，或挑战「费曼终极试炼」：用自己的话驳倒守门人，赢得「星界大师」徽章。
4. **地表纯享漫游**：通关后在开满花的地表上慢速滑行。航道两侧有发光的「记忆星碑」，每根星碑上浮着一张知识卡片，随距离放大、淡入淡出。按 `M` 打开「全息星典总览」，按章节查看整份文档的全部要点。
5. **知识问答**（`/ask`）：基于当前星球对应的 PDF 提问，回答下方显示耗时和 token 用量。
6. **星界鉴赏室**（`/gallery`）：收藏所有 100% 点亮的星球，可以回看星碑，或直接降落进地表纯享漫游。

界面全程只用一个常驻的 WebGL 画布，切换页面时不会重新加载 3D 场景。音效默认静音；系统开启「减弱动态效果」时，会关闭震屏、闪烁和弹性动画。

仓库内置两颗 100% 完成的示范星球，不上传 PDF 也能体验漫游和鉴赏室。示范星球没有对应的后端文档，在问答页只能走网页搜索。

---

## 问答怎么决定答案来源

1. 前端把 PDF 传到 `/api/upload`。后端解析、按标题和段落切块（默认约 2500 字，重叠 200，尽量不在公式中间断开），用本地嵌入模型写入 ChromaDB，并抽取知识单元存为知识地图。
2. 提问时先在当前文档里检索。
3. 模型给检索结果打相关性分：`full`、`partial` 或 `none`。
4. `full` 或 `partial`：只用文档内容回答。
5. `none`：通过 MCP 调用 DuckDuckGo 搜索网页再回答。网页片段带 `Web result` 前缀，不会被说成文档原文。
6. 响应里的 `metrics` 包含总耗时，以及评分和生成两次调用合计的 token。

费曼终极试炼也走同一个问答接口，界面会标出判定依据来自「上传文档」还是「Web result」。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 语言 | Python 3.12、TypeScript |
| 对话模型 | DashScope Qwen（OpenAI 兼容接口，默认 `qwen3.7-plus`） |
| 嵌入模型 | 本地 `sentence-transformers/all-MiniLM-L6-v2`，离线加载 |
| 代理框架 | LangChain、LangGraph |
| 向量库 | ChromaDB |
| 网页搜索 | DuckDuckGo，经 FastMCP 独立进程提供 |
| 后端 | FastAPI、Uvicorn |
| 前端 | React 19、Vite、React Router、Three.js（自定义着色器、EffectComposer 泛光）、Web Audio |

对话、区域生成、费曼判定共用 `app/llm_factory.py`。Groq 是可选的，不是启动条件。

---

## 克隆之后不会带上的文件

这些路径在 `.gitignore` 里，需要每台机器自己准备：

| 路径 | 内容 |
| --- | --- |
| `.env` | API key。不要提交，也不要转发别人的密钥 |
| `models/` | 嵌入模型，约 90MB |
| `uploads/` | 上传的 PDF、文档目录和知识地图 |
| `chroma_db/` | 向量索引 |
| `.venv/`、`frontend/node_modules/` | 本地依赖 |

学习进度（区域、光门、鉴赏室收藏、徽章）存在浏览器的 localStorage 里，换浏览器不会同步。

---

## 环境要求

- 官方 Python 3.12（[python.org](https://www.python.org/downloads/)）。3.11 装不了 `requirements.txt` 里的 `numpy==2.5.1`。Windows 上不要用 MSYS2 / UCRT64 的 `python`，它的虚拟环境布局和平台标记与 Windows 轮子不兼容。
- Node.js 20 或更新版本。
- 能访问 DashScope 兼容接口的网络。第一次安装 PyTorch 和前端依赖时也需要联网。
- 支持 WebGL 2 的浏览器。

Windows 上请用 PowerShell，下面的 Windows 命令都按 PowerShell 书写。

---

## 安装

在仓库根目录执行。

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

`pip install` 会安装 PyTorch，第一次可能要几分钟。可以确认当前解释器在本仓库的 `.venv` 里：

```powershell
python -c "import sys; print(sys.executable)"
```

### 2. 环境变量

```powershell
copy .env.example .env
```

macOS / Linux 用 `cp .env.example .env`。然后在 `.env` 里填写：

| 变量 | 说明 |
| --- | --- |
| `DASHSCOPE_API_KEY` | 必填 |
| `DASHSCOPE_BASE_URL` | 必填，DashScope 的 OpenAI 兼容模式地址 |
| `DASHSCOPE_MODEL` | 默认 `qwen3.7-plus` |
| `LLM_MAX_TOKENS` | 输出上限，默认 16384（含推理 token） |
| `GROQ_API_KEY` | 可选；填了才需要另装 `pip install langchain-groq` |
| `HF_HUB_OFFLINE` | 模型下载好之后设为 `1`，运行时不再访问 Hugging Face |
| `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` | 只有本机必须走代理才填；`NO_PROXY=localhost,127.0.0.1` 用来避开本机服务 |

后端只读取仓库根目录的 `.env`。不要把代理地址或密钥写进准备提交的文件。

### 3. 嵌入模型

程序读取 `models/all-MiniLM-L6-v2`。目录不存在时上传 PDF 会失败。需要这些文件：

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

可以用镜像下载。下载时关闭 Hugging Face 的 Xet 通道，否则镜像可能返回 401：

```powershell
$env:HF_ENDPOINT = "https://hf-mirror.com"
$env:HF_HUB_DISABLE_XET = "1"
.\.venv\Scripts\python.exe -c "from huggingface_hub import snapshot_download; snapshot_download('sentence-transformers/all-MiniLM-L6-v2', local_dir='models/all-MiniLM-L6-v2')"
```

模型页面：<https://hf-mirror.com/sentence-transformers/all-MiniLM-L6-v2>。`1_Pooling/config.json` 必须放在 `1_Pooling` 子目录里。

### 4. 前端依赖

```powershell
cd frontend
npm install
cd ..
```

---

## 运行

开三个终端，都先进入仓库根目录。跑 Python 的两个终端要先激活虚拟环境。

终端 1，网页搜索服务（端口 8001）：

```powershell
.\.venv\Scripts\Activate.ps1
python -m mcp_server.server
```

终端 2，后端（端口 8000）：

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn app.api.main:app --reload --port 8000
```

看到 `Application startup complete` 后，接口文档在 <http://127.0.0.1:8000/docs>。直接打开 `http://127.0.0.1:8000/` 返回 404 是正常的，页面不由这个端口提供。

终端 3，前端（端口 5173）：

```powershell
cd frontend
npm run dev
```

浏览器打开 <http://localhost:5173/>。开发时页面里的 `/api` 请求由 Vite 转发到 8000。三个终端都要保持运行。

---

## 目录

```text
├── app/
│   ├── api/main.py              # FastAPI 路由
│   ├── ui/backend.py            # 上传、问答、区域与光门生成、费曼判定
│   ├── graph.py                 # LangGraph：检索 → 评分 → 生成 / 网页搜索
│   ├── llm_factory.py           # DashScope Qwen（可选 Groq）
│   ├── metrics.py               # 耗时与 token
│   ├── prompts/                 # 评分、生成、区域（zone_prompt）等提示词
│   └── rag/                     # 解析、结构切块、嵌入、检索、文档目录、知识地图
├── mcp_server/                  # DuckDuckGo 搜索（FastMCP）
├── frontend/
│   ├── public/                  # 正式素材：mascot.png、quest/、tutor-assets/
│   └── src/
│       ├── cosmos/              # 常驻 3D 场景 CosmosScene2.ts、星球身份、地表、预置星
│       ├── pages/               # 首页、星图、轨道 HUD、星界鉴赏室
│       └── components/
│           ├── explore/         # 星球探索、穿门航行、结算舱、纯享漫游、全息伴侣
│           ├── chat/            # 知识问答
│           ├── library/         # 上传与档案
│           └── shell/           # 轨道模式切换等外壳
├── tests/                       # pytest：切块、知识地图、问答图、文档目录、区域与光门等
├── requirements.txt
└── .env.example
```

`frontend/src/components/` 里还保留着闪卡、测验、记忆配对、经典闯关等旧组件，它们已不在界面上。

---

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/upload` | 上传 PDF：切块、嵌入、抽取知识地图 |
| `GET` | `/api/documents` | 文档列表（含星球名、配色、简介） |
| `GET` | `/api/documents/{id}/file` | 打开已保存的 PDF |
| `DELETE` | `/api/documents/{id}` | 删除文档 |
| `POST` | `/api/chat` | 问答（LangGraph，返回来源类型与 `metrics`） |
| `POST` | `/api/zones` | 生成星球知识区域与双生光门；`stage` 为 `first` 只生成星球简介、区域规划和第 1 区，`rest` 补齐其余区域，默认 `full` |
| `POST` | `/api/zones/feynman` | 守门人按要点给费曼解释打共鸣度 |

闪卡、测验、学习计划、思维导图、记忆配对、闯关等旧接口仍在后端，前端已不调用。完整列表见 <http://127.0.0.1:8000/docs>。

---

## 测试

```powershell
.\.venv\Scripts\Activate.ps1
pytest tests
```

---

## 常见问题

- PowerShell 里不要运行 `.venv\Scripts\activate`，Windows 官方 Python 的脚本是 `.\.venv\Scripts\Activate.ps1`。
- 找不到 `uvicorn` 或 `npm`：对应终端没有激活 `.venv`，或终端还在用安装 Node 之前的 `PATH`，重新打开终端即可。
- 上传时报缺少 `sentence_transformers`：在已激活的环境里重新执行 `pip install -r requirements.txt`。
- 上传或提问时去连 `huggingface.co`：模型目录不完整，或没有设置 `HF_HUB_OFFLINE=1`。
- 页面一直在思考或区域生成失败：后端没启动，或当前网络访问不了 DashScope，看后端终端的报错。区域生成失败时，探索页会退回本地拼出的题目。
- 开发时听到持续的低频声音：热更新残留了旧的音频上下文，整页刷新一次（Ctrl+F5）。
- 3D 场景卡顿：确认浏览器开启了硬件加速，或在系统里打开「减弱动态效果」。

这个仓库目前适合 clone 后在本机运行。GitHub Pages 只能托管静态页面，代替不了 FastAPI、ChromaDB 和 MCP 服务。

---

## License

This project is developed for educational and research purposes as part of the Dell Technologies GSOP'26.
