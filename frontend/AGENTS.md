# 前端

改 `frontend/` 下的页面、样式、素材或交互时读本文件。闯关战斗与关卡规则另见 `frontend/src/components/quest/AGENTS.md`。接口契约见 `app/AGENTS.md`。

首页是全屏峡谷 3D。`/chat` 是同一 WebGL 上下文上的 PDF 星图。问答 / 闪卡 / 闯关是轨道态全息 HUD，不要再销毁画布。不要把记忆配对加回主流程。

## 代码入口

- `src/App.tsx`：`CosmosProvider` 在路由外常驻画布（`z-index: 0`）。路由：`/` 英雄页、`/chat` 星系、`/ask` 问答、`/quest` 闯关、`/flashcards` 闪卡、`/layout` 仍独立。
- `src/cosmos/CosmosContext.tsx`：单例 `CosmosScene`。离开页面**不要** `dispose()`。
- `src/pages/Landing.tsx`：`/?panel=upload` 上传浮层。查看已有内容进 `/chat`。
- `src/pages/GalaxyArchive.tsx`：星图标签、创世上传、星球行动面板。
- `src/pages/OrbitStage.tsx`：右侧毛玻璃 HUD 壳。
- `src/cosmos/CosmosScene2.ts`：当前 3D 场景。`ViewMode`：`landing` / `galaxy` / `orbit`。`syncPlanets` / `spawnPlanetAnimation` / `focusPlanet`。旧版 `CosmosScene.ts` 仍保留。
- `src/index.css`：单一 `cosmos` 主题。内页背景必须透明或深空毛玻璃，不能盖死画布。
- 档案上传组件：`library/Bookshelf.tsx`。闯关：`quest/QuestView.tsx`。
- 当前文档 id / 文件名：`ai-tutor-current-document-v2`、`ai-tutor-current-document-name-v2`。点星球即激活该文档。

Vite 把 `/api` 代理到 `localhost:8000`。前端不要写死完整后端 URL。

## 素材

正式静态资源在 `frontend/public/`：`public/quest/`、`public/tutor-assets/`。仓库根目录未跟踪的同名 png/jpg 不是页面引用路径。

## 动效与交互

- 英雄页 loader 1s 淡出；intro 后 UI 1.6s 淡入。滚轮漫游；鼠标推开粒子，中心不要过曝成奶油白。
- 两块玻璃卡 hover 触发 `startHoverTransition()`。
- `sessionStorage` 键 `ai-tutor-landing-intro`：同会话回 `/` 跳过 intro 等待。
- 音效默认静音。
- 画布全站常驻。星系可拖拽旋转、滚轮远近。选中星球 0.8s fly-to 进入 `orbit`。
- 星球标签用 DOM overlay，不要用 Three.js 3D 中文。
- `prefers-reduced-motion`：静帧、无弹性创世。
- ≤820px：功能卡与右侧 HUD 可铺满。
- 闯关区域解锁、答题弹层、首领战攻击帧：见 quest 的 `AGENTS.md`。无文档时链到 `/chat`。

## 改前端时

1. 只改本次任务涉及的文件。
2. 用浏览器走：首页两块 → 上传（3D 不断）→ `/chat` 星图 → 点星球进轨道 HUD → 问答/闯关/闪卡 → 返回星系。
3. 空态、加载、上传失败都要能看到。
