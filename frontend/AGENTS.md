# 前端

改 `frontend/` 下的页面、样式、素材或交互时读本文件。闯关战斗与关卡规则另见 `frontend/src/components/quest/AGENTS.md`。接口契约见 `app/AGENTS.md`。

首页是全屏峡谷 3D。`/chat` 是同一 WebGL 上下文上的 PDF 星图。轨道态只有两个核心模式：星球探索（`/explore`，主推）和知识问答（`/ask`），外加返回星系，切换条是 `components/shell/OrbitModes.tsx`。不要再销毁画布。不要把闪卡、记忆配对、经典闯关加回界面。

## 代码入口

- `src/App.tsx`：`CosmosProvider` 在路由外常驻画布（`z-index: 0`）。路由：`/` 英雄页、`/chat` 星系、`/explore` 星球探索、`/ask` 问答、`/layout` 仍独立。`/quest` 带参数重定向到 `/explore`；`/flashcards` 已无路由。`QuestView`、`FlashcardsView`、`MemoryGame` 文件保留但不挂载。
- `src/cosmos/CosmosContext.tsx`：单例 `CosmosScene`。离开页面**不要** `dispose()`。
- `src/pages/Landing.tsx`：`/?panel=upload` 上传浮层。查看已有内容进 `/chat`。
- `src/pages/GalaxyArchive.tsx`：星图标签、创世上传、星球行动面板。
- `src/pages/OrbitStage.tsx`：右侧毛玻璃 HUD 壳。
- `src/cosmos/CosmosScene2.ts`：当前 3D 场景。`ViewMode`：`landing` / `galaxy` / `orbit` / `surface`。`syncPlanets` / `spawnPlanetAnimation` / `focusPlanet`。旧版 `CosmosScene.ts` 仍保留。
- 地表漫游 `surface`（由 `/explore` 的 `SurfaceRun` 调用）：`enterSurface(docId, { gates, terraform, tour })` 做 1.0s 大气层俯冲，`exitSurface()` 回轨道。地表世界在 `SURFACE_ORIGIN`（y=-420），背景星尘改为天穹并压到 0.22 透明度。光门左右并排，同一时间只显示并投影当前一组：上一组落到相机身后（玩家越过 9m）才在前方 90m 激活下一组，0.6s 淡入（`GateAnchor.fade` 供文字同步）；不做色调映射，花海不封顶 alpha，地表 Bloom 固定 0.6/阈值 0.34（ACES 方案用户嫌太暗已撤回）；题目文字由 `SurfaceRun` 固定在屏幕左右（`.gate-label.left/right`，27%/73%、top 58%），不跟随光门投影，只随 `fade` 淡入和 `focus` 高亮；进入 40m 内速度 smoothstep 降到 25%、FOV 微收，穿门 0.3s 内恢复。A/D 或 ←/→ 变道（`steerSurface` 供触屏）。`onGateAnchors` 每帧推左右门屏幕坐标，`onGateCross` 报告选择；`correct` 缺省时 React 调 `resolveSurfaceGate`。答对释放冲击波环，shader 按 `uTerraform` / `uPlanetColor` 逐片点亮花海；`tour: true` 时 `uTerraform = 1`。减弱动态：无震屏、无 RGB 故障闪烁，俯冲和复苏都改为透明度渐变。
- `src/index.css`：单一 `cosmos` 主题。内页背景必须透明或深空毛玻璃，不能盖死画布。
- 档案上传组件：`library/Bookshelf.tsx`。闯关：`quest/QuestView.tsx`。
- 地表探索 `/explore`：`components/explore/ZoneExplorer.tsx`（扫描档案 → 三阶段 → 费曼对线；对线区有概念胶囊与「◈ 调阅原典线索」抽屉）、`ResonanceTether.tsx`（共鸣丝线）、`zones.ts`（`ai-tutor-zones-v1:<document_id>` 存档，接 `/api/zones`、`/api/zones/feynman`，失败时本地降级）。3D 信标在 `cosmos/planetSurface.ts`，场景每帧经 `onZoneAnchors` 推送信标屏幕坐标。入口是星系星球面板的「降落地表探索」。
- 音频（`CosmosScene2` 的 `ValleyAudioController`）全局单例 `AudioContext`，`masterGain` ≤ 0.15。背景是生成式宇宙风铃（C 大调五声 261.63–783.99Hz 纯正弦短音，1.4–2.6s 触发，无持续 Pad / 无噪声 Buffer / 无锯齿 / 无 <220Hz 长音）。`setMuffled` 只放慢触发并压峰值。交互走 `sfxGain` 0.9：`playUiTick`（D6）、`playGatePass(combo)`（C6–E6–G6–C7 风铃琶音 + 八度泛音，半音上移最多 7）、`playErrorBuzz`（E5→B4）、`playResonanceBoom`（C 大调和弦分解）。模块带 `import.meta.hot.dispose` 关闭旧 `AudioContext`，热更新后不会残留旧版长音。旧名 `playTick`、`playGateChord` 保留为别名。
- 地表滑翔器是「流光星灵」：晶体核心 + 对称光翼 + 42 点粒子尾迹，按横向速度侧倾（最大 ±25°），穿门时放一圈加速光环。React 在 `onGateCross` 里调 `setGateCombo(n)`，答对时复苏波纹范围随连击放大（最多 2 倍）。
- 首区秒开：`fetchZones` 先请求 `/api/zones` `stage: "first"`（星球简介 + 4 区规划 + 第 1 区完整数据），其余区域以 `pending: true` 占位；`ZoneExplorer` 后台用 `stage: "rest"` 补齐（同星球请求去重，失败重试一次后丢弃占位），离开页面时结果直接写进 `ai-tutor-zones-v1:<id>`。`SurfaceRun` 遇到还在生成的下一章会挂起并显示“仍在后台扫描”，数据到了自动铺门。
- 每章 3~4 道门（定义 → 机制 → 细节/误区 → 应用），预置星每区 3 道。HUD 有连击徽章；每章通关后右侧弹「章节知识星碑」（`codexFor`，展示 4.2s，下一章光门延后 2.5s），鉴赏室卡片里可展开全部星碑。
- 通关后的地表纯享漫游（`SurfaceRun` 的 `touring`：结算舱点「切入纯享漫游」，或鉴赏室「地表纯享漫游」带 `/explore?document=<id>&tour=1` 直接降落）挂 `TourReview.tsx`：`reviewCardsFor` 汇总各章光门论断为 8~12 张卡片（过多等距抽样，过少用星碑铭文/扫描结论/费曼要点补），`scene.setSurfaceMonoliths(n)` 让引擎在 `x≈±7.5` 左右错落循环铺 6 根发光星碑（间距 30m，滑行速度降到 55%），每帧经 `onMonolithAnchors` 推送前方 12~52m 内星碑顶端投影和 `weight`/`near`，卡片朝外侧展开、随距离放大淡入并在擦身前淡出。底部胶囊「◈ 全息星典总览 [M]」或 M 键切换中央深空毛玻璃面板（`rgba(6,10,20,0.68)` + `blur(18px)`），按章节列星球简介、区域简介、全部要点与星碑铭文，Esc 也能关。
- 品牌名是「Starlore 知识星典」（`index.html` 标题与各页 `landing-logo` / `hud-logo`）。localStorage 键仍沿用 `ai-tutor-*`，不要改名以免丢存档。
- 星界全息伴侣 `HoloCompanion.tsx` 读 `/mascot.png`（缺图时显示发光 ✦ 占位），在地表航行和 `/explore` 轨道 HUD 左下角；进度越高呼吸越大、星光越多，答对 `mascot-cheer` + 鼓励气泡，答错 `mascot-wobble`，减弱动态时改为透明度脉冲。
- 穿门航行：任务舱顶部「降落地表 · 穿门航行」切到 `SurfaceRun.tsx`，隐藏顶栏、任务舱和信标标签，只剩极简 HUD（星球名、区域分段进度、同步率、退出）和底部换轨提示；键盘 A/D、←/→，鼠标拖拽、点屏幕两侧或横向滚动都能换轨。光门题来自 `gatesFor`（预置星 `cosmos/presetGates.ts` → 后端 `zone.gates` → 由 circuit/calibration 本地拼）。引擎一次只铺当前区域的门，答错或漏门时在本区末尾 `appendSurfaceGates` 重排一次，并弹「守门人认知校准」浮层（3.0s 或空格跳过，显示 `probe` 反问）。进度存进 `ZoneSave.gates`，区域门全过即标 completed。全部区域完成后 600ms 调 `playSurfaceFinale()`（绽放 + 镜头拉升），再出 `SurfaceFinale.tsx` 结算舱：「收录进星界鉴赏室」（`ai-tutor-gallery-collected-v1`，可切 `startSurfaceTour()` 纯享漫游）或「费曼终极试炼」（`askGuardianTrial` 走 `/api/chat`，回复最后一行「判定：已说服/未说服」，按 `source_type` 标「上传文档 / Web result」，接口失败退回本地估算；说服后写 `ai-tutor-master-badge-v1:<id>` 金色「星界大师」徽章）。
- 星球身份与进度：`cosmos/planetIdentity.ts`（四套主题配色、星球名生成、4 档阶段 `getPlanetStage`：0% 未探索 / 1–29% 或选中 探索中 / 30–99% 部分完成 / 100% 全部完成）。场景里 `CosmosScene2` 按 `DocumentItem.progress` 驱动 shader `uStage` 与外围装饰（虚线环、进度环、信标、能量弧、日冕、成就星环）；区域存档变化经 `ZONES_UPDATED_EVENT` 调 `setPlanetProgress`，不改 documents 状态以免镜头重飞。
- 预置示范星：`data/planetPresets.ts` 是公开入口（类型、3 条星碑、`presetRecords`），区域剧本在 `cosmos/presetPlanets.ts`。id 以 `preset-` 开头，后端没有这两份文档，问答页对它们只能走网页搜索。
- `/gallery` 星界鉴赏室（`pages/StarGallery.tsx`）：列出进度 100% 的星球；`?tour=<id>` 为纯享漫游（轨道视角 + 星碑轮播）。首页第三张卡进入。
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
