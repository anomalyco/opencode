---
name: vi-design
description: Octopus 视觉识别 (VI) 全流程——视觉 LLM 协作设计、资产同步、品牌一致性维护与跨包传播；单源 SVG 导出多平台图标、CSS token 同步、CLI ASCII logo、邮件模板与社交卡片回归
---

# VI Design

此 Skill 供 feature-dev / core-dev / platform Agent 使用。

**职责边界**：本 skill 涵盖两个阶段——*用视觉 LLM 辅助创作* 与 *资产同步落地*。

- ✅ 用视觉 LLM（Claude / GPT-4V / Gemini）做品牌诊断、方向探索、视觉 QA、guideline 起草
- ✅ 替换 logo 文件、改色板、改 CLI ASCII logo、生成多尺寸图标、维护 brand 资产清单
- ✅ 直接手写或修改简单几何 SVG path（如现有方块字 logo）
- ❌ 不修改 Effect 服务、Drizzle schema、业务逻辑代码——遇到这类改动转 core-dev
- ❌ 不做最终美学决策——LLM 提供候选与评估，**人类拍板**
- ❌ 不期待生图模型直接产出可用矢量 logo（栅格 → 矢量质量不稳，仅供灵感参考）

## 当前品牌现状

仓库目前并存两套品牌资产：

1. **opencode**（上游遗留）— `packages/console/app/src/asset/brand/` 整套 SVG/PNG + zip
2. **octopus**（本仓库）— 由 `packages/ui/src/components/logo.tsx` 内嵌 SVG path 渲染（24×36 viewBox 的方块字形 `OPCODE` / `GOPHER` 风格）

短期内**两套并行**，长期目标是 octopus 一统。

## 资产清单 (Single Source of Truth)

| 类别 | 路径 | 用途 |
|---|---|---|
| **UI 组件** | `packages/ui/src/components/logo.tsx` | `<Mark>` `<Splash>` `<Logo>` 三个 SolidJS SVG 组件（**主源**，颜色由 CSS 变量驱动）|
| **UI 样式** | `packages/ui/src/components/logo.css` | logo 尺寸/对齐 |
| **Web 落地页** | `packages/web/src/assets/logo-{light,dark,ornate-light,ornate-dark}.svg` | Astro 静态站 |
| **Console 内嵌** | `packages/console/app/src/asset/logo.svg`, `logo-ornate-{light,dark}.svg`, `lander/logo-{light,dark}.svg` | 控制台/落地页 |
| **Console Brand 包** | `packages/console/app/src/asset/brand/opencode-*.{svg,png}` + `opencode-brand-assets.zip` | `/brand` 路由的下载页（**仍是 opencode 品牌**）|
| **桌面应用图标** | `packages/desktop/icons/{prod,dev,beta}/` + `packages/desktop/resources/icons/` | macOS `.icns`、Windows `.ico`、Linux/Web `.png` 多尺寸（30×30 ~ 310×310，含 `android/` `ios/` 子目录）|
| **邮件模板** | `packages/console/mail/emails/templates/static/logo.png` | 注册/通知邮件 |
| **Favicon** | `packages/ui/src/assets/favicon/favicon.{svg,ico}` + `packages/docs/favicon.svg` | 浏览器 tab 图标（`.ico` 多尺寸容器） |
| **Apple Touch Icon** | `packages/ui/src/assets/favicon/apple-touch-icon.png` | iOS Safari 添加到主屏幕 / PWA |
| **社交卡片** | `packages/ui/src/assets/images/social-share{,-zen,-black}.png` | `og:image` meta tag（`console/entry-server.tsx`, `/routes/index.tsx`, `/zen`, `/go`, `/black`） |
| **CLI ASCII** | `packages/octopus/src/cli/logo.ts` | TUI 启动屏 ASCII 艺术字（`OPCODE` `GO` 风格块字）|
| **TUI 组件** | `packages/octopus/src/cli/cmd/tui/component/logo.tsx` | TUI logo 渲染（Ink/React）|

⚠️ **每次新增 logo 引用必须更新此表**。

## CSS 颜色 Token 系统

颜色由 `packages/ui/src/styles/tailwind/colors.css` 集中映射：

- 所有 `--color-*` 变量都是 `var(--<底层变量>)` 的别名
- 真正的色值定义在主题层（light/dark/octopus.css 等），找底层变量定义用：

```bash
rg -n "^\s*--surface-brand-base:" packages/ui/src/styles/
rg -n "^\s*--icon-strong-base:" packages/ui/src/styles/
```

- logo.tsx 用的是 `--icon-strong-base` `--icon-base` `--icon-weak-base`——改 logo 颜色就改这三个 token，**不要**在 logo.tsx 里写死颜色
- 品牌主色：`--surface-brand-base` / `--surface-brand-hover`、`--text-on-brand-base`

## LLM 协作设计工作流（创作上游）

> 这套流程的产出是"一份精确的 master SVG + 色板 + guideline"。完成后再进入下方"标准工作流"做仓库内传播。

### 能力分布速查

| 任务 | 视觉 LLM 能力 | 用法 |
|---|---|---|
| 解读现有 logo / 截图 | 强 | ✅ 必用 |
| 给出设计方向描述 / moodboard 思路 | 强 | ✅ 必用 |
| 生成栅格 PNG logo 草案 | 中 | ⚠️ 仅做灵感 |
| 生成可用矢量 SVG logo | 弱 | ❌ 别期待一步到位 |
| 从参考 PNG 还原 SVG | 中 | ✅ 先描摹/封装验证，不要手写猜图 |
| 多尺寸 / 多场景一致性 review | 强 | ✅ 必用 |
| 色板生成（hex/HSL，含 light/dark） | 强 | ✅ 必用 |
| WCAG 对比度审计 | 强 | ✅ 必用 |
| ASCII art logo（文本块字） | 中-强 | ✅ 可直出 |
| 复杂插画 / 吉祥物 / 自定义字形 | 弱 | ❌ 需专业设计师 |

### Phase 1 — 诊断与方向探索

**输入**：现有 logo 渲染图 + 品牌定位一句话 + 竞品参考（可选）

**给视觉 LLM 的 prompt 模板**：

```
我在做一个名为 octopus 的 [项目定位一句话] 的视觉识别。
附上现有 logo 图像（[路径或粘贴]）。请：
1. 用 100-150 字描述当前 logo 的几何系统、语义、气质
2. 指出它在 [目标受众/场景] 下的 3 个不足
3. 提出 3-5 个差异化方向，每个含：核心意象、几何系统、字体气质、色彩倾向、典型应用场景
4. 对每个方向给出一条最强反驳，避免锚定偏差
不要画图，只输出文字方案。
```

**产出验收**：拿到方向清单后，**人类拍板选 1 个**进入 Phase 2。

### Phase 2 — 视觉打样（可选，需生图模型）

⚠️ 关键陷阱：**不要让生图模型直接画 "octopus logo"**——会得到一堆糟糕的章鱼卡通。要描述**视觉系统**（几何/留白/线宽/材质），不描述**画一只章鱼**。

**Midjourney / Imagen / Flux 用法**：

- 生成 moodboard（材质、肌理、空间感）
- 生成"风格示意"而非"logo 候选"
- 把 4-8 张结果**回喂视觉 LLM**："这几张里哪张最贴合方向 X？哪些视觉元素可提取成几何系统？"

跳过 Phase 2 也行——简单几何 logo 直接进 Phase 3。

### Phase 3 — 矢量收口（产出 master SVG）

三条路径，按你手头资源选：

1. **有设计师** — Figma/Illustrator 出 SVG，导出后跳到 Phase 4
2. **无设计师，简单几何** — 让 LLM 直接写 SVG path。本仓库现有 `logo.tsx` 就是 24×36 viewBox 的方块字（`<path d="M12 16H4V8H12V16Z" ...>` 这种），完全可对话产出。给 LLM 的约束：
   - 明确 viewBox（建议沿用 24×36 或对应字符数等比扩展）
   - 限制为整数坐标 + 水平/垂直边（保证像素对齐）
   - 颜色用 `var(--icon-strong-base)` / `var(--icon-base)` / `var(--icon-weak-base)` 三层 token
   - 产出后用 SVGOMG 压缩 + 视觉 LLM 复查识别度
3. **无设计师，复杂形状** — 用 Phase 2 PNG 作参考，手工在 Figma 重绘，或外包

#### 参考 PNG → SVG 还原实战

当用户明确给出参考图（例如 workspace 里的 `octopus.png`）并要求“参考它重新生成”时，**禁止先凭视觉印象手写一套新 SVG**。这会导致比例、曲线、字标、留白全部跑偏。先把参考图当作 ground truth，还原流程如下：

1. **先读图并确认边界**
   - 用 Read 查看图片，确认透明背景、实际内容边界、线稿颜色、是否含字标。
   - 用 ImageMagick 辅助量测：`identify ref.png`、`convert ref.png -alpha extract -threshold 1% -format "%@" info:`。
   - 如果图片是透明 PNG，不要凭截图观感添加整屏背景；透明画布就是资产的一部分。

2. **先做视觉一比一 SVG 封装版**
   - 先产出一个 SVG wrapper，内嵌原 PNG：`<image href="data:image/png;base64,..." .../>`。
   - 这个版本不是纯矢量，但能建立“视觉不跑偏”的基准，方便用户先确认方向。
   - 文件命名建议：`<name>-embed.svg` 或临时 `octopus-logo.svg`，不要把它误称为 master vector。

3. **再做纯矢量描摹版**
   - 优先使用 `potrace` / `vtracer` / Inkscape Trace Bitmap；没有 tracing 工具时，可用 ImageMagick 预处理 alpha、灰度阈值、边界框，再生成 path。
   - 自动描摹版通常“视觉像，但路径脏”；保留为 `<name>-vector.svg`，作为清理输入，不直接当最终 master。
   - 对白色主体和深色线稿分层输出，保留 `fill-rule="evenodd"`，否则眼睛、字母内孔、触手内部线条容易丢。

4. **路径清理要分区处理**
   - 可以对章鱼主体、装饰图形做 `path-simplify`，但要逐步渲染对比。
   - 字标 / wordmark / 自定义字体区域不要盲目简化。自动简化会改变 `OCTOPUS` 这类空心字的字宽、圆角、内孔和笔画节奏。
   - 如果整体简化后字标失真，使用混合策略：上半部分用简化路径，下半部分用未简化的高保真描摹路径，并用 `clipPath` 按区域裁切。

5. **每轮都做客观对比**
   - 用 Inkscape 渲染候选 SVG：`inkscape logo.svg --export-filename=/tmp/logo.png --export-width=1024 --export-height=1024`。
   - 用 ImageMagick 检查内容边界：`convert /tmp/logo.png -alpha extract -threshold 1% -format "%@" info:`。
   - 用 `compare -metric RMSE ref.png /tmp/logo.png null:` 做整体差异评估；必要时裁剪字标区域单独比较。
   - RMSE 不能替代人眼判断，但能快速发现“整体像、局部漂”的情况。

6. **输出分层资产，不混淆用途**
   - `*-embed.svg`：视觉基准，内嵌 PNG，最像原图但不是纯矢量。
   - `*-vector.svg`：自动描摹原始版，适合后续清理，通常路径较重。
   - `*-master.svg`：清理后的正式候选版。必须说明哪些区域简化过，哪些区域保持高保真。
   - 如果文件体积从十几 KB 回升到几十 KB 是为了保住字标细节，这是可接受的设计取舍。

经验结论：**已有参考图时，先还原，再优化；不要先重绘。Logo 的文字区域比吉祥物主体更怕自动简化，必须单独保护。**

**色板生成 prompt**：

```
为 octopus 项目生成一套色板：
- 主色倾向：[一句话，如"沉稳深青、技术感、不刺眼"]
- 输出 Radix-style 12 阶 light + 12 阶 dark
- 每阶给 hex + 用途（背景/边框/弱文/强文/品牌主面/品牌悬停）
- 给出 light/dark 下与白色/黑色文本的 WCAG 对比度
- 同时给出对应到本仓库的 token 映射建议：
  --surface-brand-base / --surface-brand-hover / --text-on-brand-base /
  --icon-strong-base / --icon-base / --icon-weak-base
```

**CLI ASCII logo prompt**（LLM 文本本职）：

```
用字符 █▀▄_^~, 画 "OCTOPUS" 的 4 行块字 ASCII，要求：
- 每个字母宽 4 字符、高 4 行
- 字符 _^~, 用于细节阴影（TUI 渲染时这些字符会应用弱化色）
- 输出格式同 packages/octopus/src/cli/logo.ts 的 left/right 数组结构
- 必须每行等长
```

### Phase 4 — 视觉 QA

把候选 SVG 在所有场景渲染成 PNG，**一次性**丢给视觉 LLM：

```
附上这套 logo 在以下场景的渲染：
- 16×16 favicon
- 32×32 / 64×64 / 128×128 desktop icon
- 1024×1024 macOS dock
- 黑底 / 白底 / 灰底
- 灰度（模拟无障碍）
- 50% / 25% 缩放模糊（模拟 retina 降采样）

请逐一指出：
1. 哪些尺寸下识别度崩了？为什么？
2. 哪些场景需要单独优化版本（如 favicon 简化版）？
3. 与现有 packages/ui 的 icon system 视觉重量是否匹配？
```

### Phase 5 — Guideline 起草

让 LLM 基于最终资产写 brand guideline（落到 `packages/web/src/content/docs/brand.mdx` 或新建 `packages/console/app/src/routes/brand/`）：

- 最小尺寸、安全留白、禁用变形示例
- 色板使用规则（哪种 surface 配哪种 text）
- 字体搭配（如有）
- 应用示例：social card、邮件 header、CLI banner

### Phase 6 — 跨平台一致性回归（每次改动后）

把改动前后的 desktop icon / web logo / 邮件 logo / TUI 截图打包丢给视觉 LLM：

```
对比这两组截图（before / after），评估：
1. 三个 channel (prod/dev/beta) desktop icon 视觉一致吗？仅色相变化是否合理？
2. 邮件 logo PNG 在白底 / 黑底邮箱客户端下都清晰吗？
3. TUI ASCII logo 字符密度与 web logo 视觉重量是否匹配？
4. 整体品牌识别是否在所有平面统一？
```

### LLM 协作的安全栏

- **每个 Phase 结束都要人类拍板**——LLM 是协作者不是决策者
- **不要让 LLM 直接 commit 设计资产**——先在 `/tmp/opencode/vi-draft/` 落地，人类目检后再进仓库
- **保留每轮 prompt 与产出**到 `.opencode/vi-history/<date>-<phase>.md`（可选，便于复盘）
- **生图模型产出绝不直接当 logo 用**——必须经 Phase 3 矢量收口

---

## 标准工作流

### A. 替换 logo（SVG 主源 → 全平台传播）

前提：你拿到了一份新的 master SVG（建议 24×36 viewBox 与现有保持一致，或重新设计 viewBox 但同步改 logo.tsx）。

1. **改 `packages/ui/src/components/logo.tsx`** — 这是 SolidJS 内嵌源，最高优先级。保留 `fill="var(--icon-*-base)"` 引用，不要硬编码颜色。
2. **更新独立 SVG 文件**（落地页/控制台）：
   ```bash
   # Web
   packages/web/src/assets/logo-{light,dark,ornate-light,ornate-dark}.svg
   # Console
   packages/console/app/src/asset/logo.svg
   packages/console/app/src/asset/logo-ornate-{light,dark}.svg
   packages/console/app/src/asset/lander/logo-{light,dark}.svg
   packages/console/app/src/asset/lander/brand-assets-{light,dark}.svg
   ```
3. **重新生成 brand 资产包**（如做 octopus 品牌则放在 `packages/console/app/src/asset/brand/octopus-*.{svg,png}` 并新建 zip）
4. **重新生成桌面图标** — 见下方"图标批量生成"
5. **重渲染 favicon + apple-touch-icon** — 从 master SVG 导出 `.png` `.ico` `.svg` 到 `packages/ui/src/assets/favicon/` 和 `packages/docs/`
6. **重渲染社交卡片** — `packages/ui/src/assets/images/social-share*.png` 对应 `og:image` 引用的三张图（主站 / zen / black）
7. **重新生成邮件 logo PNG** — `packages/console/mail/emails/templates/static/logo.png`（≥ 2x 显示密度）
8. **更新 Storybook 快照** — `packages/ui/src/components/logo.stories.tsx`
9. **跑完整 checklist**（最末节）

### B. 改色板（品牌主色等）

1. 在 `packages/ui/src/styles/` 找到底层变量定义文件（不是 `tailwind/colors.css`，那里只是别名）
2. 只改语义 token，不改 logo.tsx 中的 `var(--icon-*)` 引用名
3. 跑 `bun storybook` 视觉回归 logo / icon-button / toast / brand surface
4. 检查 light/dark 对比度（WCAG AA ≥ 4.5:1 文本，≥ 3:1 大字/图标）

### C. 改 CLI ASCII Logo

`packages/octopus/src/cli/logo.ts` 是块字 ASCII，由 `█▀▄_^~,` 组成的 4 行字符画。

- 必须保持 `left` `right` 两段等长（按当前文件每段 4 行，行宽对应字符宽度）
- `marks = "_^~,"` 是"细节字符集"，TUI 在渲染时会对它们应用弱化色
- 改完用 `tmux new-session -d -s octopus-dev 'bun dev'` 启动 TUI，然后 `tmux capture-pane -pt octopus-dev` 抓画面，确认对齐（参考 `packages/octopus/AGENTS.md` 的 TUI 调试规范）

### D. 图标批量生成（单 PNG/SVG → 多平台多尺寸）

桌面需要这些尺寸（`packages/desktop/icons/prod/` 现状）：

```
32x32  64x64  128x128  128x128@2x
Square30x30  Square44x44  Square71x71  Square89x89  Square107x107
Square142x142  Square150x150  Square284x284  Square310x310
StoreLogo  dock  icon.png  icon.ico  icon.icns
android/  ios/
```

工具选择：

- **realfavicongenerator.net**（一份 master PNG ≥ 512×512 → 全套含 manifest）
- **electron-icon-builder**（CLI: `electron-icon-builder --input=./master.png --output=./packages/desktop/icons/prod --flatten`）
- **ImageMagick 兜底**：
  ```bash
  for size in 32 64 128; do
    magick master.png -resize ${size}x${size} packages/desktop/icons/prod/${size}x${size}.png
  done
  magick master.png -resize 256x256 -define icon:auto-resize=256,128,64,48,32,16 packages/desktop/icons/prod/icon.ico
  ```
- macOS `.icns` 用 `iconutil -c icns IconSet.iconset` 或 `png2icns`
- 三套 channel 全套同步：`prod/` `dev/` `beta/`，三者通常仅色相不同（dev 偏黄、beta 偏紫等）

## 资产引用扫描

新增或重命名资产前，先查所有引用点：

```bash
# 所有 logo 引用（含 import、Astro/Vite 静态资源、HTML、CSS url()、邮件模板）
rg -n -i 'logo[-_.]' --type ts --type tsx --type astro --type css --type html --type md packages/ packages/web/

# 桌面图标在 electron-builder 配置中的引用
rg -n 'icons/(prod|dev|beta)' packages/desktop/

# 邮件模板 logo
rg -n 'static/logo' packages/console/mail/

# 社交卡片 og:image 引用
rg -n 'og:image' packages/console/

# favicon 引用
rg -n 'favicon' --type ts --type tsx --type html packages/
```

## 命名规范

- 文件名：`<brand>-<variant>-<theme>[-<shape>].{svg,png}`
  - 例：`octopus-wordmark-simple-light.svg`、`octopus-logo-dark-square.png`
- variant: `logo` | `wordmark` | `wordmark-simple` | `mark`（仅图标无字）
- theme: `light` | `dark`
- shape: `square`（圆角方形，社交头像/favicon 用）| 省略（默认横版）

新品牌全套至少包含 16 个文件：
`{logo,wordmark,wordmark-simple} × {light,dark} × {svg,png}` + `logo-{light,dark}-square × {svg,png}` + 1 个 preview 用 PNG 套件 + 打包 zip。

## Checklist（改 logo / 改品牌色后必跑）

- [ ] `bun typecheck` 全通过（logo 组件 prop 类型未破坏）
- [ ] `bun storybook` 手动看 logo.stories / icon.stories / icon-button.stories
- [ ] 桌面三个 channel（prod/dev/beta）图标都更新
- [ ] 邮件 logo PNG 在 light/dark 邮箱客户端均可读（Gmail/Outlook/Apple Mail）
- [ ] CLI `bun dev` TUI 启动屏对齐无错位
- [ ] Web 落地页 `/` 与 console `/brand` 路由视觉一致
- [ ] favicon `.ico` / `.svg` / `.png` 全部更新到 `packages/ui/src/assets/favicon/` 和 `packages/docs/favicon.svg`
- [ ] apple-touch-icon 更新到 `packages/ui/src/assets/favicon/apple-touch-icon.png`
- [ ] 社交卡片 `social-share*.png` 全部重渲染（主站 / zen / black 三张），确认 `og:image` markdown 正确
- [ ] README.md / docs 中嵌入的 logo 图引用是否要换（如指向 `packages/console/app/src/asset/brand/` 的链接）
- [ ] `packages/console/app/src/routes/brand/index.tsx` 下载页清单 + zip 重打包
- [ ] 删除遗留旧品牌文件（如完成 opencode → octopus 切换），并 `git mv` 保留历史
- [ ] 单独 commit：`vi: <change>`，便于回滚

## 排除规则

不要碰这些"看起来像 logo 但不是品牌资产"的文件：

- `packages/ui/src/assets/icons/file-types/*.svg` — 文件类型图标（vite/vim/vitest 等第三方）
- `packages/ui/src/assets/icons/provider/*.svg` — LLM 服务商 logo（不是 octopus 自家）
- `node_modules/`、`dist/`、`.turbo/`

## 推荐外部参考（设计判断阶段）

- **Brand Guidelines 范例**：Primer / GitLab Design / Mozilla Protocol / IBM Carbon
- **色板系统**：Radix Colors（12 阶 light/dark 对子）、uicolors.app
- **SVG 优化**：SVGOMG（jakearchibald.github.io/svgomg）
- **图标批量**：realfavicongenerator.net、electron-icon-builder
- **对比度审计**：WebAIM Contrast Checker

这些是**素材源**，不是 skill；最终落到本仓库还是要按上面工作流同步。
