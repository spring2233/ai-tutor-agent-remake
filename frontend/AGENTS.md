# 前端

改 `frontend/` 下的页面、样式、素材或交互时读本文件。闯关战斗与关卡规则另见 `frontend/src/components/quest/AGENTS.md`。接口契约见 `app/AGENTS.md`。

首页是全屏峡谷 3D + 两块玻璃功能（上传内容、查看已有内容）。问答 / 闪卡 / 记忆配对已从主流程拿掉，不要加回侧栏或顶栏功能块。只有闯关才换战场 3D。

## 代码入口

- `src/App.tsx`：`/` 峡谷场景浮层；`/quest` 战场场景 + `QuestView`；`/layout` 仍独立。
- `src/pages/Landing.tsx`：`/?panel=upload` 与 `/?panel=library` 切浮层，**不要卸载** `CosmosScene`。
- `src/pages/QuestStage.tsx`：`mode: 'arena'` 的新场景，离开时 `dispose`。
- `src/cosmos/CosmosScene.ts`：`wander` / `arena`。
- `src/index.css`：单一 `cosmos` 主题。
- 档案：`library/Bookshelf.tsx`。闯关：`quest/QuestView.tsx`。聊天/闪卡/记忆配对文件还在，但未挂进路由。
- 当前文档 id / 文件名：`ai-tutor-current-document-v2`、`ai-tutor-current-document-name-v2`。闯关继续共用这一对 key。

Vite 把 `/api` 代理到 `localhost:8000`。前端不要写死完整后端 URL。

## 素材

正式静态资源在 `frontend/public/`：`public/quest/`、`public/tutor-assets/`。仓库根目录未跟踪的同名 png/jpg 不是页面引用路径。

## 动效与交互

- 英雄页 loader 1s 淡出；intro 后 UI 1.6s 淡入。滚轮漫游；鼠标推开粒子，中心不要过曝成奶油白。
- 两块玻璃卡 hover 触发 `startHoverTransition()`。
- `sessionStorage` 键 `ai-tutor-landing-intro`：同会话回 `/` 跳过 intro 等待。
- 音效默认静音。
- 峡谷场景只在离开 `/`（进 `/quest`）时 dispose；档案浮层必须共用同一 canvas。
- `prefers-reduced-motion`：静帧、无自动漂移。
- ≤820px：两块功能卡可换行。
- 闯关区域解锁、答题弹层、首领战攻击帧：见 quest 的 `AGENTS.md`。无文档时链到 `/?panel=library`。

## 改前端时

1. 只改本次任务涉及的文件。
2. 用浏览器走：首页两块 → 上传/档案（3D 不断）→ 闯关换场景 → 返回档案。
3. 空态、加载、上传失败都要能看到。
