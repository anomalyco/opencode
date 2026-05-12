# Discovery: Octopus 章鱼形象品牌资产体系建设

## 问题陈述

项目虽有 `@octopus-ai/*` 的命名和 CLI binary `octopus`，但**视觉上没有任何章鱼形象**。所有用户可见的 logo 仍是几何方块字（234×42 的 "OPCODE" 风格）或抽象 O-ring。用户提供了一张 1024×1024 的章鱼 PNG，需要将其转化为完整的品牌资产体系，让 Octopus 项目"看起来像 octopus"。

## 用户原始表达

> "试一下 octopus.png 是否有用？"

> "同意！"（同意以此 PNG 为基础做品牌资产体系 Discovery）

## 根本需求（5 Whys）

| 层 | 问题 | 答案 |
|----|------|------|
| 1 | 用户说了什么？ | "把 octopus.png 用到项目里" |
| 2 | 为什么需要？ | 项目叫 Octopus 但没有任何章鱼形象 |
| 3 | 为什么没有章鱼形象是问题？ | 品牌名与视觉脱节——用户在 CLI、网页、文档、桌面图标看到的都是几何方块字，不是章鱼 |
| 4 | 为什么现有品牌资产不够？ | v0.1.0 品牌迁移只做了**字符串替换**（opencode→octopus），没有引入真正的章鱼视觉语言 |
| 5 | 根本原因是什么？ | 项目需要从"名义上的 Octopus"升级为"视觉上的 Octopus"，建立用户一眼就能认出的章鱼品牌辨识度 |

### Want vs Need

| | |
|---|---|
| **Want** | 把 octopus.png 替换几个文件 |
| **Need** | 让 Octopus 在全触点（CLI、网页、文档、桌面图标、社交卡片、邮件、扩展）都呈现一致的章鱼视觉形象 |

## 查重结果

| 来源 | 结果 | 判定 |
|------|------|------|
| `.octopus/discovery/2026-05-11-opencode-to-octopus-rebrand.md` | 存在，但只涉及字符串级重命名（opencode→octopus），不涉及章鱼视觉设计 | **不重复** |
| `.octopus/discovery/2026-05-12-post-migration-cleanup.md` | 存在，关注残留 opencode 引用清理 | **不重复** |
| `CHANGELOG.md` (v0.1.0) | "Brand assets: UI themes, CSS classes, icons updated" — 但只是改名，非设计新资产 | **未实现** |
| GitHub Issues | 零相关 Issue（品牌工作走 `.octopus/` agent 系统） | **不重复** |
| `.octopus/skills/vi-design/SKILL.md` | 存在完整 VI 设计工作流指导 | **可复用** |

**重复判定**: ☑ 全新需求（之前的 rebrand 是字符串级，本次是视觉设计级）

## 影响范围初判

### 当前品牌资产全景

项目存在**两套并行品牌** + **100+ 资产文件** + **12 个触点**：

| 触点 | 路径 | 当前状态 | 文件数 |
|------|------|----------|:------:|
| UI Logo 组件 | `packages/ui/src/components/logo.tsx` | 234×42 几何方块字 (OPCODE 风格) | 2 |
| Web 落地页 logo | `packages/web/src/assets/logo-*.svg` | 4 个方块字变体 | 4 |
| Docs logo | `packages/docs/logo/{light,dark}.svg` | 绿色渐变 blob + opencode 文字 | 3 |
| Console 内嵌 logo | `packages/console/app/src/asset/logo*.svg` | 方块字 + O-ring | 8 |
| Console Brand 下载包 | `packages/console/app/src/asset/brand/` | **28 个 opencode 品牌文件** | 28 |
| Console Lander | `packages/console/app/src/asset/lander/` | 8 个 opencode 资产 + 2 个 mp4 | 16 |
| 桌面应用图标 | `packages/desktop/icons/{prod,dev,beta}/` | O-ring mark, 3 通道 × ~90 文件 | ~270 |
| Favicon & Touch Icon | `packages/ui/src/assets/favicon/` | O-ring mark, 8 文件 | 8 |
| 社交卡片 | `packages/ui/src/assets/images/social-share*.png` | 3 张 OG 图片 | 3 |
| 邮件模板 | `packages/console/mail/emails/templates/static/` | opencode 文字 logo | 2 |
| CLI ASCII | `packages/octopus/src/cli/logo.ts` | 拼写 "OPCODE"（不是 OCTOPUS） | 2 |
| Zed 扩展 | `packages/extensions/zed/icons/octopus.svg` | 16×16 O-ring | 1 |
| Identity 主源 | `packages/identity/` | O-ring mark (SVG + 4 PNG) | 5 |
| **总计** | | | **~350+** |

### 新增资产

| 资产 | 说明 |
|------|------|
| `octopus.png` (已有) | 1024×1024 RGBA 章鱼，项目根目录 |
| `packages/identity/octopus.svg` (待创建) | PNG → SVG 矢量化主源 |

### 变更级别

**L 级**（150-500 文件），实际需要修改的文件 ~90 个（删除 opencode 旧资产 + 替换为新章鱼资产），但桌面图标涉及到 ~270 个文件的批量重新生成。

## 方案空间

### HMW

> 如何让 Octopus 项目在用户接触的所有界面（CLI、Web、桌面、文档、社交）都呈现出一致的章鱼品牌形象？

### 候选方案

#### 方案 A（保守）: Quick Drop

**思路**: 将 octopus.png 直接放入几个关键位置（README、docs logo、社交卡片），不改动现有几何方块字体系。两套视觉并存——方块字做主 logo，章鱼 PNG 做点缀。

| 维度 | 内容 |
|------|------|
| Trade-off | 最小工作量，但品牌割裂——方块字和章鱼动物是两种完全不同的视觉语言 |
| 范围 | ~5 文件 |
| 适合 | 想快速测试章鱼形象的接受度 |

#### 方案 B（标准）: Vectorize & Propagate ✅ 推荐

**思路**: 将 octopus.png 矢量化为 SVG 作为**主品牌标记**（替代 O-ring），系统性地传播到所有触点。保留几何方块字作为**次级字标**（wordmark），形成「章鱼图标 + octopus 字标」的经典组合。

| 维度 | 内容 |
|------|------|
| Trade-off | 工作量中等（~100 直接修改 + ~270 批量生成），需要确保 PNG→SVG 矢量化质量 |
| 范围 | ~90 直接文件 + ~270 批量生成 |
| 适合 | 追求品牌一致性，愿意投入一次系统升级 |

#### 方案 C（激进）: Full Octopus Design System

**思路**: 不仅换图标，而是以章鱼为灵感重新设计整个品牌语言——从章鱼提取配色板（蓝紫渐变、吸盘肌理），设计动画章鱼 mascot（触手摆动），CLI ASCII 画真章鱼，甚至 Sound FX 加入深海音效。

| 维度 | 内容 |
|------|------|
| Trade-off | 视觉冲击力最强，但工作量大、设计决策多、需要人类反复拍板 |
| 范围 | ~100 直接文件 + ~270 生成 + 新设计资产 + 动画 |
| 适合 | 想建立高度差异化的品牌，有设计资源投入 |

### 类比迁移

| 项目 | 做法 | 可借鉴 |
|------|------|--------|
| GitHub (Octocat) | 吉祥物 + 字标组合，吉祥物有表情和姿势变化 | Octocat 不是 octopus 但同为海洋生物，可参考"吉祥物+字标"模式 |
| Docker (Moby) | 鲸鱼吉祥物 + 简洁字标 | 动物形象承载品牌情感，字标保持专业感 |
| VS Code | 无吉祥物，纯几何图标 | 方块字路线在开发者工具领域有先例 |
| 本项目 VI skill | 已定义完整资产传播工作流 | 直接复用 Phase 1-6 LLM 协作设计流程 |

### 推荐

**方案 B（Vectorize & Propagate）**。理由：

1. octopus.png 质量已经很好，不需要从零设计（跳过 Phase 1 Diagnose）——直接进入矢量化和系统传播
2. 用户的核心诉求是"让项目看起来像 octopus"，方案 B 覆盖所有触点且不会过度设计
3. 现有的 VI design skill 正好为此类系统传播提供了标准工作流
4. 如果后续想做动画/深海主题，方案 B 的矢量主源是方案 C 的基础

## Issue 拆解

### 依赖关系图

```
Issue 1: Master SVG & Identity Suite  ← 所有下游 Issue 的根基
  ├── Issue 2: Web, UI & Favicon Integration
  ├── Issue 3: Console Brand Kit Migration
  ├── Issue 4: Desktop App Icons Regeneration
  ├── Issue 5: Marketing Assets (social cards, email, Zed)
  └── Issue 7: CSS Brand Palette Refresh

Issue 6: CLI ASCII Octopus  ← 独立，可并行于 Issue 1
```

---

### Issue 1: Master SVG & Identity Suite [XS]

**描述**: 将 `octopus.png` 矢量化为高质量 SVG 主源，并从主源衍生出完整的 identity 变体集。

**范围** (`packages/identity/`):
- PNG → SVG 矢量化：创建 `octopus.svg`（512×512 主源）
- 衍生变体：`octopus-light.svg`（浅色背景版）、`octopus-square.svg`（方形裁剪版，用于 app icon/favicon）
- 单色版：`octopus-mono.svg`（用于单色场景如 CLI、水印）
- 字标搭配：决定章鱼图标与 "octopus" 文字的组合方式（水平/垂直/仅图标）
- 更新 `packages/identity/` 的 PNG 渲染（`mark-*.png` → `octopus-*.png`）

**预估文件数**: ~10 文件

**验收标准**:
- [ ] `octopus.svg` 在 512×512 下清晰可辨，< 50KB
- [ ] 缩放到 16×16 仍可辨识章鱼形态
- [ ] dark/light 变体在对应背景下对比度达标
- [ ] `packages/identity/` 目录下 opencode 旧资产已清理

**前置依赖**: 无（唯一根节点）

**可分配给**: `feature-dev` (VI design skill)

---

### Issue 2: Web, UI & Favicon Integration [S]

**描述**: 将新章鱼 identity 集成到所有面向 Web 和 UI 的 logo 触点。

**范围**:
- `packages/ui/src/components/logo.tsx` — 更新 `<Mark>` `<Splash>` `<Logo>` 组件使用章鱼 SVG（或建立新的章鱼组件）
- `packages/web/src/assets/logo-{light,dark,ornate-*}.svg` — 替换为章鱼 logo 变体
- `packages/docs/logo/{light,dark}.svg` — 替换绿色 blob 为章鱼图标 + "Octopus" 字标
- `packages/docs/favicon.svg` — 替换为章鱼 favicon
- `packages/ui/src/assets/favicon/` — 重新生成所有 favicon 尺寸（favicon.svg, favicon.ico, favicon-96x96.png, apple-touch-icon.png）
- `packages/console/app/src/asset/logo*.svg` — 替换内容为章鱼

**预估文件数**: ~25 文件

**验收标准**:
- [ ] Web 落地页 header 显示章鱼 logo
- [ ] Docs 站 header 显示章鱼 logo + 字标
- [ ] 浏览器 tab 图标是章鱼
- [ ] `logo.tsx` 组件在 UI 中正确渲染章鱼
- [ ] Console 内嵌 logo 更新

**前置依赖**: Issue 1

**可分配给**: `feature-dev`

---

### Issue 3: Console Brand Kit Migration [M]

**描述**: 将 Console `/brand` 路由的整个品牌下载包从 opencode 替换为章鱼品牌资产。

**范围** (`packages/console/app/src/asset/brand/`):
- 删除所有 `opencode-*` 文件（~28 个）
- 基于 Issue 1 的 identity suite 生成章鱼品牌资产：
  - `octopus-logo-{dark,light}.{svg,png}`（垂直版 logo）
  - `octopus-logo-{dark,light}-square.{svg,png}`（方形版）
  - `octopus-wordmark-{dark,light}.{svg,png}`（字标版）
  - `octopus-wordmark-simple-{dark,light}.{svg,png}`（简化字标版）
  - 预览图 `preview-octopus-*.png`
- 重新打包 `octopus-brand-assets.zip`
- 更新 `/brand` 路由页面文字（"OpenCode Brand" → "Octopus Brand"）

**预估文件数**: ~40 文件（28 删除 + 12 新建）

**验收标准**:
- [ ] `/brand` 页面展示的是章鱼 logo 变体，不是 O-ring
- [ ] 下载 `octopus-brand-assets.zip` 包含所有变体
- [ ] 页面不再提及 "OpenCode"

**前置依赖**: Issue 1

**可分配给**: `feature-dev`

---

### Issue 4: Desktop App Icons Regeneration [L]

**描述**: 基于新章鱼 identity mark，重新生成所有桌面平台的应用图标。

**范围** (`packages/desktop/icons/{prod,dev,beta}/`):
- 每个通道（prod/dev/beta）生成完整图标集：
  - macOS: `.icns` + `icon.png`(512×512) + `dock.png`(256×256)
  - Windows: `.ico`（含多分辨率）+ UWP tile 图标（9 尺寸 Square + StoreLogo）
  - iOS: AppIcon 全套（20×20 ~ 1024×1024，含 @1x/@2x/@3x）
  - Android: mipmap 全套（mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi，含 round/foreground）
- **注意**: 章鱼在极小尺寸（16×16, 20×20）下的辨识度需验证

**预估文件数**: ~270 文件（3 通道 × ~90 文件）

**验收标准**:
- [ ] 桌面 Dock/任务栏图标显示章鱼
- [ ] Windows 开始菜单磁贴显示章鱼
- [ ] macOS 应用切换器显示章鱼
- [ ] Android/iOS 主屏幕图标显示章鱼

**前置依赖**: Issue 1

**可分配给**: `feature-dev` + `platform`（批量生成可能需要脚本）

---

### Issue 5: Marketing Assets [XS]

**描述**: 更新社交分享卡片、邮件模板 logo 和 Zed 扩展图标。

**范围**:
- `packages/ui/src/assets/images/social-share.png` — 重新生成 OG 分享图（1280×721，含章鱼 + 字标）
- `packages/ui/src/assets/images/social-share-zen.png` — Zen 路由分享图
- `packages/ui/src/assets/images/social-share-black.png` — Go/Black 路由分享图
- `packages/console/mail/emails/templates/static/logo.png` — 邮件模板 logo
- `packages/console/mail/emails/templates/static/zen-logo.png` — Zen 邮件 logo
- `packages/extensions/zed/icons/octopus.svg` — 替换 16×16 O-ring 为章鱼

**预估文件数**: ~6 文件

**验收标准**:
- [ ] 社交媒体分享时 OG 卡片显示章鱼
- [ ] 注册/邀请邮件 header 显示章鱼 logo
- [ ] Zed 扩展面板图标是章鱼

**前置依赖**: Issue 1

**可分配给**: `feature-dev`

---

### Issue 6: CLI ASCII Octopus [XS]

**描述**: 重写 TUI 启动屏 ASCII 艺术，从拼写 "OPCODE" 改为章鱼主题的 ASCII art。

**范围**:
- `packages/octopus/src/cli/logo.ts` — 替换 `logo` 常量（当前 4 行 × 38 列拼 "OPCODE"）为章鱼 ASCII art
- 选项 A: ASCII 章鱼动物图案（触手 + 头部），纯装饰
- 选项 B: 用块字符拼 "OCTOPUS"（当前是 "OPCODE"，只差一个字母但长度不同）
- `packages/octopus/src/cli/cmd/tui/component/logo.tsx` — 如果艺术尺寸变化，可能需要调整渲染参数

**预估文件数**: ~2 文件

**验收标准**:
- [ ] TUI 启动屏显示章鱼主题视觉（不再是 "OPCODE" 方块字）
- [ ] 现有的鼠标交互（点击涟漪/音效）继续正常工作
- [ ] Idle shimmer 动画适配新 ASCII 布局

**前置依赖**: 无（可完全并行）

**可分配给**: `feature-dev`（ASCII art + TUI 组件）

---

### Issue 7: CSS Brand Palette Refresh [XS]

**描述**: 从章鱼 artwork 提取配色，更新 CSS 品牌色 token。

**范围**:
- `packages/ui/src/styles/theme.css` — 调整 `--surface-brand-*`、`--text-on-brand-*`、`--icon-brand-*` 等 token
- 从 `octopus.png` 提取主色（蓝紫）和辅色，确保 light/dark 主题下对比度达标
- `packages/docs/docs.json` — 如有必要同步 docs 站配色

**预估文件数**: ~3 文件

**验收标准**:
- [ ] 品牌色 token 与章鱼 artwork 的色调协调（不要求完全一致，但不能冲突）
- [ ] Light/dark 模式下 WCAG AA 对比度达标

**前置依赖**: 无（可并行，只要知道章鱼大致配色）

**可分配给**: `feature-dev`

---

## 汇总

| Issue | 名称 | 规模 | 预估文件 | 依赖 | 可并行 |
|:-----:|------|:----:|:--------:|------|:------:|
| 1 | Master SVG & Identity Suite | XS | ~10 | — | — |
| 2 | Web, UI & Favicon Integration | S | ~25 | #1 | #4~#7 |
| 3 | Console Brand Kit Migration | M | ~40 | #1 | #2~#7 |
| 4 | Desktop App Icons Regeneration | L | ~270 | #1 | #2~#7 |
| 5 | Marketing Assets | XS | ~6 | #1 | #2~#7 |
| 6 | CLI ASCII Octopus | XS | ~2 | — | #1~#7 |
| 7 | CSS Brand Palette Refresh | XS | ~3 | — | #1~#6 |

### 并行执行计划

```
Wave 1 (并行):
  Issue 1  ← root, 先行
  Issue 6  ← 完全独立
  Issue 7  ← 独立（知道章鱼配色即可）

Wave 2 (并行, 依赖 #1):
  Issue 2
  Issue 3
  Issue 4
  Issue 5
```

**总预估**: 7 个 Issue，~356 文件（含 ~270 桌面图标批量生成），可在一轮 Waves 内完成。

## 决策

☑ 采用**方案 B（Vectorize & Propagate）**

☑ 进入 P1 → 由 orchestrator 创建 7 个 GitHub Issue 并分派

## 补充说明

### 章鱼在极小尺寸下的挑战

章鱼动物形象（触手 + 吸盘 + 眼睛）在 16×16 下可能辨识度严重下降。Issue 1 需要特别验证。如果 16×16 不可行，可考虑：
- favicon/小图标使用简化的章鱼剪影（去吸盘细节，只保留圆形头部 + 8 条触手轮廓）
- 与完整版章鱼图标保持视觉连续性

### 与现有几何方块字的关系

方案 B 建议「章鱼图标 + octopus 字标」组合。几何方块字可以退役（移除 `logo.tsx` 的旧 `<Logo>` 组件路径），但 CSS 颜色 token 机制（`--icon-strong-base` 等）保留——只是章鱼 SVG 不一定用这些 token。
