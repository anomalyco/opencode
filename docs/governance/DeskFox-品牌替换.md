# 13 — DeskFox 品牌替换(最小可见档)

## Context

opencode-fork 一直叫 "OpenCode"(继承自 anomalyco/opencode 上游)。User 已为本项目定名 **DeskFox** 并产出完整品牌设计手册(Tangram 几何风格,8 个 light SVG + 5 个 dark SVG + 多尺寸 PNG + 8 色板 + 双主题色映射 + 字体 + slogan,在 `D:\Kbase\奇思妙想\opencode\品牌设计\`)。本次目标:**让 user 双击启动后第一眼看到的视觉就是 DeskFox**,且**正确支持 light / dark 双主题**(按 user 第十节色映射精确实现,**严禁 `filter: invert(1)`**),但**不动**底层 identifier / CLI / deep-link / Rust 路径(全量替换 ~5-6 小时,有 settings 数据迁移风险,等品牌走稳再做)。

User 明确要求:**最小可见改动**,不展开 i18n / 全平台 icon / Rust 内部命名 / 字体替换。

**关键约束:本品牌层必须严格遵守 [`12-fork-跟随升级与协作规范.md`](./12-fork-跟随升级与协作规范.md)**(同会话 user 立的 fork 治理总纲)。本计划落实其中三条直接相关:

| 12 号规范条款 | 本计划落实方式 |
|---|---|
| **R1 三级跳**(能新文件就别动上游) | logo / theme / icon 三块都走"新增文件 + alias / 级联"路径,不动上游同名文件 |
| **R2 FORK marker**(动了上游必须 `// FORK: <reason> <date>`) | 块 1 conf(JSON 不支持注释,例外)+ 块 2 HTML title + 块 5 入口 import 都加 FORK marker |
| **R3 hardcode 三禁令**(品牌字符串/主题色/icon 走配置或 branding 包) | 主题色走 CSS overlay ✓ / icon 走 ps1 脚本 ✓ / **所有自有文件集中到 `packages/branding/`(R3 明确推荐)** |

**漂移健康度更新**(本次 commit 落地后):新增上游文件 edit ~3 处(块 1 conf + 块 2 HTML title × 2),**上游侵入率**(规范 2026-04-26 改名,原"fork 偏离指数")仍 < 5%,符合 12 号规范健康基线。新建的 `packages/branding/` 全是 fork-only 文件,不计入侵入分子,反而稀释比例 = P1 隔离原则的健康信号。

---

## 规范裁决落地协议(2026-04-26 正式定稿)

> 本节根据 2026-04-26 规范 agent 5 条裁决(commit `de5e8eb` opencode-plan + `ca36d119e` opencode-fork CLAUDE.md)严格执行。

### 1. 单笔合 commit + 双标 override
本 plan 所有改动**合 1 笔 commit**,同时挂:
- `[large-diff: 换皮强耦合 - 5 块 overlay + alias + 入口 import + icon 必须一起上才能跑通]`
- `[override-blacklist: 换皮专项-DeskFox]`

按规范裁决 (2),双标算 1 笔 override 配额(测的是"破例频率"非"破例严重度"),占 1/季 ✓。**禁止拆 commit**(中间态无法验证,且会浪费配额)。

### 2. R4 single-person 模式 — D1 复核报告(commit 前必出)
测试通过后、commit 前必须出**复核报告**(三项)贴给 user 审,user 点头即 commit + push。无 24h 冷却,仅占测试通过到 commit 之间的几分钟,不阻塞实施。

复核报告三项内容:
1. **wrapper 不可行性逐文件论证** — 每个触动黑名单的文件单列:为什么 R3 推荐路径走不通必须直改
   - `tauri.{conf,prod.conf,beta.conf}.json` × 3:为什么不走 env-driven conf 生成
   - `packages/app/vite.config.ts`(或 `packages/ui/package.json`):为什么 alias 必须落这里
   - `packages/desktop/src-tauri/icons/{dev,beta,prod}/*`:为什么不能用其他路径
   - `packages/{desktop,app}/index.html`:为什么不能 JS-driven document.title
2. **风险评估** — 本次破例对 rebase / 稳定性 / 后续 sync 的影响
3. **改动日志论证审阅** — 改动日志 #11 的 wrapper 不可行性段落是否充分

### 3. baseline tag(09 节 3 强制要求)
开干前必打 `pre-deskfox-rebrand-2026-04-26` tag 在 `feat/editable-file-viewer` HEAD,出问题 1 命令回退。

### 4. commit 模板(09 节 8 + 2026-04-26 注)
按 09 节 8 模板写,"回归点"字段写"**新增功能验证点 R1-R7**"(规范裁决 4 已加注允许此措辞)。模板字段:
```
feat(branding): DeskFox 品牌替换 — overlay + alias + 主题色双主题 [large-diff: 换皮强耦合] [override-blacklist: 换皮专项-DeskFox]

后端
- (本计划无后端改动)

前端 / 配置
- packages/branding/(新)... (5 文件)
- 上游 edit:tauri.*.conf.json × 3 / index.html × 2 / vite.config.ts / 入口 css

依赖
- 无新 npm / cargo dep

文档
- 改动日志 #11 详细记录(wrapper 不可行性 + 风险评估 + 上游 contract 假设)
- docs/governance/DeskFox-品牌替换.md(本文档,2026-04-28 起,原 `opencode-plan/规划/13-...` 已迁入本仓)

baseline: pre-deskfox-rebrand-2026-04-26
关联: 改动日志.md 第 11 条
新增功能验证点: R1-R7(任务栏图标 / hover 文字 / 标题栏 / 窗口内 logo / 启动屏 SMIL / light 双主题色 / dark 双主题色含珊瑚不变青)
影响范围:
- ✅ session UI / Save / Office 预览 / Markdown / 媒体预览 / 文件树菜单(#7-#10):完全不影响
- ⚠️ 视觉:窗口标题 / 任务栏图标 / 全 logo / 主题色全部变 DeskFox(预期)
- ⚠️ 已装 OpenCode:不冲突,可同机并存(identifier 不动)

[large-diff: 5 块换皮强耦合,中间态无法验证]
[override-blacklist: 换皮专项-DeskFox - 详见复核报告 + 改动日志 #11]

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

### 5. 上游 contract 假设(R5 显性化,改动日志必写)
- 上游不更名 logo.tsx 三个 export(`Mark` / `Splash` / `Logo`)→ rebase 后 grep 验证
- 上游不删 4 个 var 名(`--surface-brand-base` / `--text-interactive-base` / `--icon-interactive-base` / `--border-selected`)→ rebase 后 grep 验证

### 6. 回滚演练(09 节 11)
本计划属"中等大改",commit 前抽几秒走一遍 `git reset --hard pre-deskfox-rebrand-2026-04-26` dry-run,确认 tag 回退路径通(实际不执行,只 verify)。

---

## 上游同步策略 / 抗 rebase 设计(对齐 12 号规范 R1+R3)

### 文件存放总原则

按 12 号规范 R3:**fork 特化集中到 `packages/branding/`**(新建轻量 monorepo 包,sync 时一目了然)。本次涉及的所有自有文件(logo / theme overlay / icon 替换脚本 / 素材 PNG)**统一放这里**,不再分散到 `packages/ui/src/components/` 或 `packages/ui/src/styles/`。

包结构:
```
packages/branding/
├── package.json                 # name: "@opencode-ai/branding", workspace dep
├── tsconfig.json                # 继承 root
├── src/
│   ├── logo.tsx                 # 3 个 export(Mark / Splash / Logo),DeskFox SVG
│   ├── theme.css                # 主题色覆盖 + logo 专用 var(light + dark)
│   └── assets/
│       ├── icon-primary-32.png      # 从用户素材库拷一份 in-tree(脱离 D:\Kbase 依赖)
│       ├── icon-primary-128.png
│       ├── icon-primary-256.png
│       └── icon-favicon-{16,32,48}.png
└── scripts/
    └── apply-icons.ps1          # 一键覆盖 src-tauri/icons/{dev,beta,prod}/* 的脚本
```

> 取舍:做轻量 monorepo 包(name `@opencode-ai/branding`)可以用 workspace 引用 + `import "@opencode-ai/branding/theme.css"`;不想做包的话退化为 `packages/branding/` 纯目录,app 用相对路径 import 也行。**实施时按 monorepo 现状决定**(grep `packages/*/package.json` 看其他包结构后照搬)。

### 冲突风险分级

| 块 | 改 upstream 文件? | 冲突风险 | 上游变更频率 | 抗 rebase 策略(对齐 R1) |
|---|---|---|---|---|
| 1 Tauri conf | ✅ 不可避免 | 低-中 | 偶尔(版本号 / bundle 配置) | edit + 保持 diff 最小(2 字段)+ 配 `[fork-only-marker.md]` 文档(JSON 无法加注释,例外条) |
| 2 HTML title | ✅ 不可避免 | 极低 | 罕见 | edit + `<!-- FORK: DeskFox brand 2026-04-26 -->` marker |
| 3 Logo SVG | ❌ **不动 upstream** | 0 | (上游持续维护) | overlay:`packages/branding/src/logo.tsx` + 路径 alias |
| 4 Icon PNG | ✅ 覆盖(脚本可重放) | 中(可接受) | 偶尔 | `packages/branding/scripts/apply-icons.ps1`,rebase 后重跑 30 秒 |
| 5 Theme CSS | ❌ **不动 upstream** | 0 | (上游持续迭代) | overlay:`packages/branding/src/theme.css` 在入口 `theme.css` 后 import,CSS 级联 override |

### overlay 架构原理

**块 3 (logo) overlay**:
- **保留** `packages/ui/src/components/logo.tsx` 完全不动
- **新增** `packages/branding/src/logo.tsx`(R3 集中存放,文件头 `/* [fork-only] DeskFox 品牌 logo,不与上游同步 */`)
- **改** `packages/app/vite.config.ts` 的 `resolve.alias`,把 `@opencode-ai/ui/logo` 解析到 `@opencode-ai/branding/logo`(`vite.config.ts` 是上游文件 → 加 `// FORK: DeskFox alias 2026-04-26` marker;若改 `packages/ui/package.json` exports 也要 marker)
- 后果:`import { Mark, Splash, Logo } from "@opencode-ai/ui/logo"` 在所有调用方代码不变,实际加载到 DeskFox 版本
- rebase 时:上游怎么改 `logo.tsx` 都跟我们无关(我们不读它)
- **上游 contract 假设**(R5 显性化):假设上游不更名 `Mark` / `Splash` / `Logo` 三个 export → 若 rebase 后 grep 不到这三个 export 名 = 红灯,需要适配

**块 5 (theme) overlay**:
- **保留** `packages/ui/src/styles/theme.css` 完全不动
- **新增** `packages/branding/src/theme.css`(R3 集中存放,文件头 `/* [fork-only] DeskFox 主题覆盖,不与上游同步 */`),内容:
  ```css
  /* 覆盖上游主题色 */
  :root {
    --surface-brand-base: #1F2D44;
    --text-interactive-base: #7295C4;
    /* ... 见块 5a */
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --surface-brand-base: #7295C4;
      /* ... */
    }
  }
  /* DeskFox logo 专用 var(块 5b) */
  :root { --logo-text: #1F2D44; ... }
  @media (prefers-color-scheme: dark) { :root { --logo-text: #F4F7FB; ... } }
  ```
- **改** 入口文件(`packages/app/src/main.tsx` 或 `packages/ui/src/styles/index.css`)在 `theme.css` import 后追加 1 行(上游文件,加 marker):
  ```ts
  /* FORK: DeskFox theme overlay 2026-04-26 */
  import "@opencode-ai/branding/theme.css"
  ```
- 后果:CSS 级联让 DeskFox 值赢,上游 theme.css 怎么改都不影响(只要他们没删我们 override 的 var 名)
- rebase 时:零冲突
- **上游 contract 假设**(R5 显性化):假设上游不删 `--surface-brand-base` / `--text-interactive-base` / `--icon-interactive-base` / `--border-selected` 这 4 个 var 名 → rebase 后 grep 这 4 个 var 仍存在 = 绿灯

**块 4 (icons) — 脚本可重放策略**:
- 没法做 overlay(tauri 构建直接读这些路径,改 conf.json 路径反而增加 conf 冲突面)
- 直接覆盖 `packages/desktop/src-tauri/icons/{dev,beta,prod}/*.png + *.ico`
- **配套**:`packages/branding/scripts/apply-icons.ps1`(R3 集中存放),从 **`packages/branding/src/assets/`**(已 in-tree 的素材副本)拷贝到 `icons/` 各路径
- 素材也 in-tree(`packages/branding/src/assets/icon-primary-{32,128,256}.png` + `icon-favicon-{16,32,48}.png`)— 脱离 `D:\Kbase\奇思妙想\` 外部依赖,任何 clone 仓库的人都能 reproduce
- rebase 后若上游推过 icon,**重跑脚本 30 秒搞定**

**块 1 / 块 2 — 不可避免的 edit + FORK marker**:
- Tauri conf:无 overlay 机制(JSON 不支持注释更不支持级联),只能 edit。**保持 diff 最小**,只改 `productName` / `mainBinaryName` 两个字段。**JSON 不能加 `// FORK:` marker → 12 号规范 R2 例外**,改动日志显式说明,FORK hook 走白名单
- HTML title:加 `<!-- FORK: DeskFox brand 2026-04-26 -->` marker 在 `<title>` 上一行

### 抗 rebase 验证(实施完成后做)

模拟 rebase 验证 overlay 真的隔离:
1. 临时改 upstream 的 `logo.tsx`(任意 path 改色)→ 重 build → DeskFox logo 应该**完全不受影响**(因为我们走 alias 加载 deskfox 版本)
2. 临时改 upstream `theme.css` 的 `--surface-brand-base` → 重 build → 我们的颜色应该**仍然赢**(级联 override)
3. 验完恢复

---

## 改动清单(5 块,共 5-6 个文件)

### 块 1 — Tauri 三套 conf 的 productName(窗口标题来源)

仅改 `productName`(和 `mainBinaryName` for dev),**不动** `identifier`(避免 Windows 注册表 / 已安装版本冲突)。

| 文件 | 行 | 当前值 | 改为 |
|---|---|---|---|
| `packages/desktop/src-tauri/tauri.conf.json` | 3 | `"OpenCode Dev"` | `"DeskFox Dev"` |
| `packages/desktop/src-tauri/tauri.conf.json` | 5 | `"OpenCode"` (mainBinaryName) | `"DeskFox"` |
| `packages/desktop/src-tauri/tauri.prod.conf.json` | 3 | `"OpenCode"` | `"DeskFox"` |
| `packages/desktop/src-tauri/tauri.beta.conf.json` | 3 | `"OpenCode Beta"` | `"DeskFox Beta"` |

> **结果**:Windows 任务栏 hover / 标题栏 / 安装包名称都变 DeskFox。`identifier` 仍 `ai.opencode.desktop.*`(注册表里的 ID,user 看不见),保持不动 → 不会跟之前装过的 OpenCode 冲突,同机可并存。

### 块 2 — HTML <title>(浏览器 tab 标题)

| 文件 | 行 | 当前值 | 改为 |
|---|---|---|---|
| `packages/desktop/index.html` | 6 | `<title>OpenCode</title>` | `<title>DeskFox</title>` |
| `packages/app/index.html` | 6 | `<title>OpenCode</title>` | `<title>DeskFox</title>` |

> **结果**:devtools / debug 窗口里看到的页面标题是 DeskFox。

### 块 3 — Logo SVG 组件(窗口内 logo / 启动屏)— **双主题适配 + overlay 抗 rebase**

**核心策略**:**不动** `packages/ui/src/components/logo.tsx`(上游文件),**新建** `packages/ui/src/components/logo-deskfox.tsx` + 加路径 alias 让 `import { Mark, Splash, Logo } from "@opencode-ai/ui/logo"` 解析到 deskfox 版本。详见上方"上游同步策略"。

**alias 落地方式**(实施时二选一,以 grep 结果为准):
- 走 **package.json `exports`**:在 `packages/ui/package.json` 的 exports 字段把 `./logo` 指向 `./src/components/logo-deskfox.tsx`(纯 monorepo 内部生效)
- 走 **vite resolve.alias**:在 `packages/app/vite.config.ts` 加 `alias: { "@opencode-ai/ui/logo": ".../logo-deskfox.tsx" }`(对消费方生效)

新建文件 `packages/ui/src/components/logo-deskfox.tsx`(本仓库自有,文件头加 `/* [fork-only] DeskFox 品牌 logo,不与上游同步 */`):

3 个 export 组件(`Mark` / `Splash` / `Logo`)用 user 双主题 SVG 实现,fill 走 logo 专用 CSS var(在块 5b 定义)。

User 规范第十节明确了 **light / dark 两套成对资产**(每色都不同 hex,见块 5 的色映射表),且**严禁 `filter: invert(1)`**(会把珊瑚点缀色染成青色)。所以不能简单"放一份 SVG 用 invert 切换",必须按 user 色映射做。

替换策略 — **用 user SVG path + 新增 logo 专用 CSS var(在 theme.css 里 light/dark 各定义一份,SVG fill 走 var,两套主题自动切)**:

| 组件 | 来源 SVG | 用到的 var(新增) |
|---|---|---|
| `Mark` | `icon-naked.svg`(浅底场景,但 fill 走 var 自动适配) | `--logo-text`, `--logo-text-secondary`, `--logo-coral` |
| `Splash` | `loading.svg`(SMIL 动画三角旋转,light + dark 颜色不同) | `--logo-text`, `--logo-coral`(中心三角) |
| `Logo` | `logo-horizontal.svg`(wordmark "DeskFox" + icon,X 由蓝/深/珊瑚三角拼成) | `--logo-text`, `--logo-text-secondary`, `--logo-coral`, `--logo-slogan` |

**关键改造步骤**:
1. 读 user 的 light SVG 拿到 path
2. 把所有 `fill="#1F2D44"` 替换为 `fill="var(--logo-text)"`,`fill="#7295C4"` → `var(--logo-text-secondary)`,`fill="#FF9A7A"` → `var(--logo-coral)`,`fill="#6B7C9A"` → `var(--logo-slogan)` 等(详见块 5 的映射表,user 第十节"颜色映射规则")
3. 容器渐变(背景渐变)如果用了 `<linearGradient>`,改用 `var(--logo-container-from)` 和 `var(--logo-container-to)` 两个 stop
4. SMIL 动画(`<animate>`)保留,只动 fill 不动结构

> 优势:**只用一份 SVG 文件,fill 走 var 自动跟主题切,不需要 picture/source 切换**。fork 现有 logo.tsx 的 inline SVG 模式天然支持。
> 取舍:略放弃了 user 规范里"icon-primary.svg 跨主题通用(自带深底容器)"的写法,但 fork 内部 logo 不需要带容器(场景是窗口内,不是社媒头像),用 `icon-naked` 系列更合适。

### 块 4 — App Icon PNG(任务栏图标 / .exe icon)— **写脚本可重放,抗 rebase**

3 套 icons 文件夹(dev / beta / prod),每套都用 user 已导出的 PNG 覆盖。**保持 tauri.conf.json 里引用的文件名不变**(避免改 conf)。

需要替换的尺寸(从 `tauri.conf.json` 引用反查):
- `32x32.png`        ← 用 user `png/icon-primary/icon-primary-32.png` 覆盖
- `128x128.png`      ← 用 `icon-primary-128.png` 覆盖
- `128x128@2x.png`   ← 用 `icon-primary-256.png` 覆盖(@2x = 256)
- `icon.ico`         ← 用 `_tools/export-png.js` 加一条任务把 `icon-favicon-{16,32,48}.png` 合并成 ICO(或用 ImageMagick `magick convert 16.png 32.png 48.png icon.ico`)。**user 待办** 第 331 行提到要做 favicon.ico 多尺寸打包 — 本次顺便做了
- `icon.icns` (macOS) — **挂账**,本次跳过(Windows 主用)
- Android / iOS 子目录 — **挂账**(不做移动端)

复制工作:每套 dev/beta/prod 各 4 个文件 = 12 个文件。

**关键 — 抗 rebase**:不要手动一个个 `cp`,**新建 `scripts/apply-deskfox-icons.ps1`** 一键脚本(本仓库自有,标记 `[fork-only]`),内容:从 `D:\Kbase\奇思妙想\opencode\品牌设计\png\` 拷贝到 `packages/desktop/src-tauri/icons/{dev,beta,prod}/` 各路径 + 调 ImageMagick 生成 .ico。**rebase 后若上游推过 icon 文件,直接重跑该脚本 30 秒搞定**,不用手动找哪些 icon 被覆盖了。

### 块 5 — Theme CSS(主题色 6 个变量 + logo 专用 6 个新 var)— **overlay 抗 rebase**

**核心策略**:**不动** `packages/ui/src/styles/theme.css`(上游文件),**新建** `packages/ui/src/styles/theme-deskfox.css`(本仓库自有,标记 `[fork-only]`)在入口 `theme.css` import 之后追加 import,CSS 级联让 DeskFox 值赢。详见上方"上游同步策略"。

入口 import 改 1 行(grep 现有 `import.*theme.css` 确定哪个文件,可能是 `packages/app/src/main.tsx` 或 `packages/ui/src/styles/index.css`),在其后追加:
```ts
import "@opencode-ai/ui/styles/theme-deskfox.css"  // [fork-only] DeskFox 品牌覆盖
```

`theme-deskfox.css` 内容由两部分组成(5a + 5b 合并到一个文件):

#### 5a — 覆盖现有主题色(level)

按 user 色板覆盖以下变量(light + dark 两块):

| 变量 | 当前 light | 当前 dark | 改为(light) | 改为(dark) | 来源 |
|---|---|---|---|---|---|
| `--surface-brand-base` | `#dcde8d` | `#fab283` | `#1F2D44` (Slate Navy) | `#7295C4` (Cool Blue) | 主品牌色 |
| `--text-interactive-base` | `#034cff` | `#9dbefe` | `#7295C4` | `#9DBBE3` (Light Blue) | 链接 |
| `--icon-interactive-base` | `#034cff` | `#034cff` | `#7295C4` | `#9DBBE3` | icon |
| `--border-selected` | `rgba(3,76,255,0.99)` | `#9dbefe` | `rgba(114,149,196,0.99)` | `#9DBBE3` | 焦点环 |
| `--border-interactive-*` 系列 | 蓝渐变 | 蓝渐变 | 用 `#7295C4` 主轴 | 同 | 边框 |
| 强调点缀(可选) | — | — | `#FF9A7A` (Warm Coral) | `#FFB89E`(深底加亮) | accent / 高亮,**面积不超 15%** |

> 严禁色:user 规范禁用 `#FF7139` Firefox 橙(Coral 是 #FF9A7A,不冲突)

#### 5b — 新增 logo 专用 var(块 3 的依赖)

按 user 第十节"颜色映射规则"给的精确光暗映射,在 theme.css 加一组 logo 专属 var:

```css
/* light(默认 :root,放 theme.css 顶部 var 区域末尾) */
--logo-text:           #1F2D44;   /* 主文字 Desk */
--logo-text-secondary: #7295C4;   /* 辅文字 Fo */
--logo-slogan:         #6B7C9A;   /* slogan */
--logo-coral:          #FF9A7A;   /* 珊瑚点缀(X 中心 / 耳内) */
--logo-container-from: #243353;   /* 容器渐变上端 */
--logo-container-to:   #172238;   /* 容器渐变下端 */

/* dark(@media prefers-color-scheme: dark 块内) */
--logo-text:           #F4F7FB;   /* 深↔浅互换 */
--logo-text-secondary: #9DBBE3;   /* 提亮一档,深底对比度 */
--logo-slogan:         #9CAFCC;   /* 提亮以达 WCAG AA 4.5:1 */
--logo-coral:          #FFB89E;   /* 深底需更亮 */
--logo-container-from: #2D3F60;   /* 容器轻提亮(elevated card 效果) */
--logo-container-to:   #1F2D44;
```

> 实施时:**不再 edit 上游 theme.css**。直接写一个 `theme-deskfox.css`,内容就是 light `:root { ... }` + dark `@media { :root { ... } }` 各 12 个 var 赋值(6 主题色覆盖 + 6 logo 新增)。CSS 级联让我们的 var 值赢。预计 ~30 分钟(overlay 比 in-place edit 还快,因为不用 grep 上游每个变量的所有出现)。

---

## 关键复用资源

- **user 品牌素材**:`D:\Kbase\奇思妙想\opencode\品牌设计\` — 8 light SVG + 5 dark SVG + 9 个 PNG 子目录(已分尺寸导出) + `_tools/export-png.js`(resvg-js,可重导新尺寸)
- **fork 现有 logo 组件**:`packages/ui/src/components/logo.tsx`(Mark / Splash / Logo 3 个 export,**不动**,通过 alias 重定向到 deskfox 版本)
- **fork 现有 theme**:`packages/ui/src/styles/theme.css`(**不动**,通过 overlay css 级联 override)
- **fork 现有 icon 路径约定**:`packages/desktop/src-tauri/icons/{dev,beta,prod}/{32x32,128x128,128x128@2x}.png + icon.ico`(覆盖文件,但配 ps1 脚本可重放)
- **fork 现有 theme 切换**:`packages/app/public/oc-theme-preload.js`(localStorage `opencode-color-scheme` = light/dark/system + `prefers-color-scheme` 双轨)

## 本次新增的 [fork-only] 文件清单(rebase 时永远保留,集中在 `packages/branding/`)

- `packages/branding/package.json` — 轻量 monorepo 包定义(name `@opencode-ai/branding`)
- `packages/branding/tsconfig.json` — 继承 root
- `packages/branding/src/logo.tsx` — DeskFox logo 3 个 export
- `packages/branding/src/theme.css` — 主题色覆盖 + logo 专用 var
- `packages/branding/src/assets/icon-primary-{32,128,256}.png` + `icon-favicon-{16,32,48}.png` — in-tree 素材副本
- `packages/branding/scripts/apply-icons.ps1` — 一键覆盖 icon 脚本
- 文件头都加注释 `/* [fork-only] DeskFox 品牌层,不与 anomalyco/opencode 上游同步,rebase 时保留 */`

## 本次 edit 的上游文件清单(都加 FORK marker,符合 12 号规范 R2)

| 文件 | 改动 | marker 形式 |
|---|---|---|
| `tauri.conf.json` × 3 | productName / mainBinaryName | **JSON 不支持注释,例外**(改动日志注明 + FORK hook 白名单) |
| `packages/desktop/index.html` | `<title>` 一行 | `<!-- FORK: DeskFox brand 2026-04-26 -->` |
| `packages/app/index.html` | `<title>` 一行 | 同上 |
| `packages/app/vite.config.ts`(或 `packages/ui/package.json`) | logo alias 1 块 | `// FORK: DeskFox logo alias 2026-04-26` |
| 入口 css 文件(`packages/app/src/main.tsx` 或 `packages/ui/src/styles/index.css`) | 追加 import 1 行 | `/* FORK: DeskFox theme overlay 2026-04-26 */` |
| `packages/desktop/src-tauri/icons/{dev,beta,prod}/*` | PNG + .ico 二进制覆盖 | **二进制无 marker,例外**(由 ps1 脚本可重放性兜底) |

---

## 验证(走 B 路径,见 `feedback_b_path_strategy.md`)

1. **typecheck**:`bun --cwd packages/app run typecheck`(不动 TS,应直接过)
2. **cargo check**:`cd packages/desktop/src-tauri && cargo check`(只动 conf 不动 rs,应直接过)
3. **runtime**:`cd packages/desktop && bun run tauri build --no-bundle` → 双击 `target/release/DeskFox.exe`(注:**exe 文件名取决于 mainBinaryName,改成 DeskFox 后变 `DeskFox.exe`**;首次 build 后路径就变了,记得用新名)
4. **手测 7 条(含双主题)**:
   - Windows 任务栏图标显示 DeskFox 三角脸 ✓(icon-primary 自带暗底容器,跨主题通用)
   - 任务栏 hover 文字显示 "DeskFox Dev"(或对应 conf 名)✓
   - 标题栏写 "DeskFox Dev" ✓
   - 启动后窗口内 logo / sidebar logo 是 DeskFox 几何风格(Mark / Logo 组件)✓
   - 启动屏 loading 三角旋转(Splash 组件 SMIL 动画)✓
   - **light mode**:logo 主文字 #1F2D44(深),辅文字 #7295C4(中蓝),珊瑚 #FF9A7A(点缀);主品牌色 Slate Navy ✓
   - **dark mode**(切系统主题或 oc-theme-preload manual override):logo 主文字 #F4F7FB(浅),辅文字 #9DBBE3(亮蓝),珊瑚 #FFB89E(更亮);主品牌色 Cool Blue;**珊瑚色不变青(无 invert 副作用)** ✓
5. 通过后 commit(参考 `改动日志.md` #10 的 entry 结构),**不要 push**,等 user 拍板

---

## 暗色适配关键警告(块 3 + 块 5 实施时严守)

- ❌ **严禁 `filter: invert(1)` 做暗色版** — user 规范明确:珊瑚色(#FF9A7A)被 invert 染成青色,违反品牌
- ❌ **严禁改色值的明度 / 饱和度** — user 规范禁用规范第 6 条
- ✅ **正解**:全部走 CSS var,light/dark 两块各按 user 第十节色映射表填,SVG fill 引 var
- ✅ **SMIL 动画**(loading 三角旋转)在 light/dark 都跑,只动 fill 不动结构,不需要写两套动画
- ⚠️ **fork 的 oc-theme-preload.js 有 manual override**(`opencode-color-scheme` localStorage = light/dark/system),不只是 `prefers-color-scheme`。新增 logo var 在 theme.css 写在哪一块,要跟 fork 现有 theme var 写在同一处(已读过:dark 块在 `@media (prefers-color-scheme: dark)` 内,manual override 由 preload.js 加 class / data-attr 覆盖)。**实施时 grep 一个现有 var 比如 `--surface-brand-base` 看它怎么放,新 var 跟着放就对**

## 不做的事(明确挂账,等 user 后续提)

- ❌ **i18n 文案**:11 个语言文件 × 5 处 "OpenCode" 不替换。中文 user 主用中文菜单,英文菜单偶现"OpenCode"字样可接受。规模小、风险也小,后续单独一个 commit 收口
- ❌ **identifier / deep-link scheme / CLI binary name / Rust 内部路径**:不动。这些改了要做 settings 数据迁移(`.opencode/` → `.deskfox/`),user 已有 OpenCode 数据会丢
- ❌ **macOS .icns / Android / iOS 全套 icon**:本次 Windows 优先,移动端 / mac 等用到再做
- ❌ **字体替换**:UI 规范要求 Inter / Geist Sans,需要装字体文件 + `@font-face` + 中文回退,工作量 1-2 小时;**最小可见档跳过**,用系统默认。Wordmark logo 已经是 SVG path(转曲),不依赖字体
- ❌ **Splash SMIL 动画的精修**:user `loading.svg` 已带 SMIL,直接用;若未来想要更高级的动效(React Spring / Lottie)再说
- ❌ **Web 端 favicon 双主题切换**:user 规范提到 `<link media="prefers-color-scheme: dark">` 双套 favicon,desktop app 用不上(只在 web 端/devtools tab 看到 favicon)。本次 desktop only,跳过

---

## 工作量估算

| 块 | 估时 |
|---|---|
| 块 0 — 新建 `packages/branding/` 包(package.json + tsconfig + workspace 接入) | 20 min |
| 块 1 — Tauri conf(改 4 个 KV) | 5 min |
| 块 2 — HTML title(改 2 行 + FORK marker) | 5 min |
| 块 3 — Logo overlay(新建 `branding/src/logo.tsx` + alias + FORK marker + 3 个组件 SVG 改造) | 60 min |
| 块 4 — Icon ps1 脚本(in-tree 素材拷贝 + 写脚本 + 跑一次覆盖 12 PNG + 3 .ico) | 40 min |
| 块 5 — Theme overlay(新建 `branding/src/theme.css` 12 var × light/dark + 入口 import + FORK marker) | 30 min |
| 抗 rebase 验证(改临时上游文件 → 验 overlay 隔离 → 恢复) | 15 min |
| 验证(typecheck + cargo check + tauri build + 手测 7 条含暗色切换) | 35 min |
| 写改动日志 #11(按 12 号规范要求写"上游 contract 假设")+ plan 归档 | 25 min |
| **合计** | **~4 小时** |

> 比纯 in-place edit 多 ~1 小时,主要是 +20 min 新建 branding 包,+15 min FORK marker / contract 假设记录。但每次未来 rebase 省 1-3 小时冲突处理(user 平均 2-4 周 rebase 一次,5-6 次后投资回本)。**且符合 12 号规范的"集中存放 + R2 marker"两条强制要求**。
