# 闯关

改闯关生成、关卡结构、战斗页或 `public/quest/` 素材时读本文件。HTTP 入口在 `app/AGENTS.md`。页面壳子和主题在 `frontend/AGENTS.md`。

## 玩家流程

1. 必须已有当前文档（URL `?document=` 或 `localStorage` 的 `ai-tutor-current-document-v2`）。没有则提示回 `/chat` 星系。
2. 未选角色则先选 `male`（剑士）或 `female`（法师），写入 `ai-tutor-hero`。
3. 无缓存任务线则调用 `POST /api/quests`，body：`{ "document_id" }`。成功后整份 quest 存 `ai-tutor-quest-v2:{documentId}`，进度清空。
4. 地图按区域顺序解锁：上一区两道任务都答对，下一区才可点。
5. 全部任务完成后才能「挑战首领」。首领 5 题，答对 ≥4 算消灭。

进度键：`ai-tutor-quest-progress-v1:{documentId}`，字段 `clearedTaskIds`、`bossHits`、`bossCleared`。

## 数据形状

后端 `generate_quest` → `_normalize_quest` 产出：

- `title`、`genre`：`research` | `teaching` | `exam`（中文「科研/教学/试题」也会被归一）
- `areas`：3 到 5 个。每个有 `id`（`area-n`）、`title`、`summary`、恰好 2 个 `tasks`
- 每个 task：`id`（`area-n-task-m`）、`concept`、`q`、4 个 `options`、`answer` 必须是选项之一、`why`
- `boss`：恰好 5 道同样字段的题，应跨区域综合、不重复任务题

题目与说明用中文；公式、符号、算法名保持原文。提示词：`app/prompts/quest_prompt.py`。生成失败最多重试 1 次；规范化失败对前端就是 400。测例：`tests/test_quest.py`。

## 交互与动效（当前实现）

- 任务答错只显示 `why`，不记完成；答对写入 `clearedTaskIds` 并关弹层。
- 首领答对：角色切 `/{hero}-attack-0.png` … `attack-4.png`，间隔 75ms，首领加 `hit` 抖动。
- 首领血量展示为 5 格，每命中减 1。5 题结束且命中不足 4：可重新挑战，不改任务进度。
- 地图底色按 `genre`：科研红、教学金、试题蓝，见 `quest.css`。

## 素材（运行时路径）

全部在 `frontend/public/quest/`：

- `male.png` / `female.png`
- `male-attack-0.png` … `male-attack-4.png`（女角色同理）
- `boss.png`、`background-fight.jpg`

根目录未跟踪的同名文件不会被 Vite 提供。不要改前端去引用仓库根路径。

## 改闯关时

- 改 JSON 字段必须同时改 `backend._normalize_quest`、`QuestView` 类型和本文件。
- 不要在没选文档时允许生成。无文档时链到 `/chat`，不要链回已删除的书架主路由。
- 不要把进度存到后端（当前没有这份 API）。
- 动效改完要走：选角 → 生成或读缓存 → 锁区 → 答题 → 首领命中/失败重开。
