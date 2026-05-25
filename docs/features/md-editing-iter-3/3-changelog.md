---
feat-id: md-editing-iter-3
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# md-editing-iter-3 — 3-changelog(实际改动 + 经验)

## commit 链(14 commits,矫正 ②-⑦ + Playwright 自测)

| # | hash | 说明 |
|---|---|---|
| 1 | `1b9f4c0ef` | docs: 1-spec 初版(程序员基线)|
| 2 | `52978936d` | docs: 1-spec **白领基线矫正** — GitHub MD CSS + iA Writer |
| 3 | `e44d40c80` | docs: 2-plan A/A/A/A/A 锁版 |
| 4 | `f7b8c8bf8` | feat: markdownHighlightStyle + 4 单测 **[R4 override-blacklist 第 1 笔:@lezer/highlight]** |
| 5 | `9e92cda44` | docs: 3-changelog + INDEX done + 改动日志 |
| 6 | `390356ed1` | refactor: **色彩矫正 ②** — `var(--primary)` 未定义 bug + Option A 现代办公配色(`text-interactive-base` 蓝 + list marker monochrome)|
| 7 | `429bcc942` | refactor: **色彩矫正 ③** — 删 monospace chip(lezer-markdown 把 fenced code block 内容也标 monospace,chip 套每 token 视觉灾难)|
| 8 | `46a4ad72f` | refactor: **色彩矫正 ④** — Prec.high 包装尝试 + 加 strikethrough |
| 9 | `68ea12d77` | test: Playwright e2e 视觉自测 spec + markdown-test fixture 678 行 **[large-diff override]** |
| 10 | `f9f15673b` | feat: **矫正 ⑥** — 扩 codeLanguages(Python/SQL/JSON/YAML/CSS) **[R4 override-blacklist 第 2 笔]** |
| 11 | `7d8f830c5` | refactor: **色彩矫正 ⑤** — 修代码块语法高亮 + heading/link 无下划线(去 default fallback + Prec.high + textDecoration:none) |
| 12 | (待 commit) | refactor: **矫正 ⑦** — Cmd+Shift+E 进编辑模式 keybind(Tauri WKWebView + SolidJS Portal 互操作限制 workaround) |
| 13 | (本笔) | docs: 3-changelog 全过程 + 经验沉淀,完整 GUI 自测路径文档化 |

## 行数 / 文件汇总

净 ~+800 行 / 9 文件:
- `packages/app/src/utils/markdown-editor-extensions.ts` ~+50 行(15 spec rule + Prec.high wrap)
- `packages/app/src/utils/markdown-editor-extensions.test.ts` ~+60 行(4 单测 H1-H4)
- `packages/app/src/utils/lang-from-ext.ts` +37 行(扩 codeLanguages 6 个语言)
- `packages/app/src/components/code-mirror-view.tsx` +7 行(去 `{ fallback: true }`,加注释)
- `packages/app/src/pages/session/file-tabs.tsx` +21 行(Cmd+Shift+E keybind)
- `packages/app/package.json` +6 deps(`@lezer/highlight` + 5 个 `@codemirror/lang-*`)
- `bun.lock` 同步更新
- `packages/app/e2e/md-editing-iter-3-visual.spec.ts` +246 行(自测 spec)
- `packages/app/e2e/md-editing-iter-3-visual-tour.spec.ts` +139 行(滚动截图 tour)
- `packages/app/e2e/mocks/markdown-test-fixture.md` 678 行(综合测试文档)

## 设计基线锁定

**copy 的方案:GitHub Markdown CSS heading 比例 + iA Writer 源模式标记符弱化 + 现代办公文档蓝色链接 accent**

| Tag | spec |
|---|---|
| `heading1` | 2em / 700 / text-strong / **textDecoration:none** |
| `heading2` | 1.5em / 700 / text-strong / textDecoration:none |
| `heading3` | 1.25em / 600 / text-strong / textDecoration:none |
| `heading4` | 1em / 600 / text-strong / textDecoration:none |
| `heading5` | 0.9em / 600 / text-strong / textDecoration:none |
| `heading6` | 0.85em / 600 / text-weak / textDecoration:none |
| `strong` | weight 700 |
| `emphasis` | italic |
| `strikethrough` | line-through |
| `quote` | text-weak + italic |
| `url` / `link` | **var(--text-interactive-base)** + textDecoration:none |
| `processingInstruction` | text-weak + opacity 0.7 |
| `contentSeparator` | text-weak + opacity 0.6 |

**为什么 white-collar 而非 programmer baseline**:GitHub MD CSS heading 比例(h1=2em / h2=1.5em / h3=1.25em)= Notion / 公众号 / 知乎 / 简书 排版同款,user 被这套训练了 10 年。`var(--text-interactive-base)` 跟 `packages/ui/src/components/markdown.css:48` 预览侧链接色一致,切预览模式 0 跳变。

## 代码块语法高亮(矫正 ⑥)

`packages/app/src/utils/lang-from-ext.ts` codeLanguages 扩到 8 个语言:

| 语言 | 注册 | 视觉验证 |
|---|---|---|
| JavaScript / JSX | `@codemirror/lang-javascript` | ✅ keyword 紫 / 字符串 绿 / 数字 橙 / 注释 红橙 |
| TypeScript / TSX | 同上(typescript:true)| ✅ interface/export const 紫 / "react" 绿 |
| **Python** | `@codemirror/lang-python` 6.2.1 | ✅ class/def/from/import/for/in/if 紫 / "Alice" 绿 / 数字 橙 |
| **SQL** | `@codemirror/lang-sql` 6.10.0 | ✅ 字符串 `'2025-01-01'` 绿 |
| **JSON** | `@codemirror/lang-json` 6.0.2 | ✅ keys/values 区分着色 |
| **YAML** | `@codemirror/lang-yaml` 6.1.3 | ✅ 注册到位(综合 fixture 无 yaml block,生产可用)|
| **HTML** | `@codemirror/lang-html` 6.4.11 | ✅ 已有 |
| **CSS** | `@codemirror/lang-css` 6.3.1 | ✅ 已有 |

每个用动态 `import` 懒加载:启动 0 bundle penalty,使用时加载单语言 chunk(~50KB 每)。

**未注册的已知边界**(留 backlog):
- **Bash / Shell**:无官方 `@codemirror/lang-bash`(只有 third-party 不主流)
- **Diff**:无 `@codemirror/lang-diff`
- **Mermaid**:无 `@codemirror/lang-mermaid`(本来就是 DSL 不是 syntax-highlighted language)

## 实施中踩的坑 / 经验沉淀

### 坑 1:用户画像必须先于美学决策(矫正 ② commit `52978936d`)

**起源**:初版 1-spec 选 VS Code / Obsidian Source Mode 紧凑程序员风(h1=1.6em / h2=1.35em / opacity 0.55)。User 提"考虑白领用户身份非程序员"后反转到 GitHub MD CSS(h1=2em / h2=1.5em)+ iA Writer(opacity 0.7)。

**教训**:**设计决策前先问"目标用户是谁"**。GitHub MD CSS = 公众号 / 知乎 / 简书排版 = 白领被训练了 10 年的视觉契约。程序员"紧凑高密度"基线对白领来说反而像"还是密密麻麻"。

### 坑 2:`var(--primary)` 在 theme.css 没定义(矫正 ② 第二部分)

初版 spec 用 `color: var(--primary)` 给 link / url / list marker — 但 theme.css 只有 `--button-primary-base`,**没有 `--primary`**。结果 CSS 变量未定义,fallback inherit,**蓝色根本没显示**。

修法:换 `var(--text-interactive-base)`(theme.css 已有 + 预览侧 markdown.css 同款)。

**教训**:CSS 变量用之前 `grep -n "^\s*--xxx:" theme.css` 确认存在 — 这种 invisible 错误单测和 e2e 断言都会假阳过。

### 坑 3:Lezer-markdown 把 fenced code block 内容也 tag 为 `t.monospace`(矫正 ③)

**起源**:Bash / JSON / Diff 等无注册 codeLanguages 时,fenced code block 全部 token tag 为 `t.monospace`。我们给 `t.monospace` 加 chip 样式(background + radius + padding)→ **每个 token 都套 chip 视觉灾难**。

修法:**完全删 `t.monospace` spec**。CodeMirror 整个编辑器已是 monospace 字体,inline code 靠可见反引号 `` ` `` 自识别(iA Writer / GitHub source view / Notion 源数据同处理)。chip 视觉留给预览侧。

### 坑 4:`{ fallback: true }` 语义错位(矫正 ⑤ 第一步)

**起源**:`code-mirror-view.tsx:33` 用 `syntaxHighlighting(defaultHighlightStyle, { fallback: true })`。CM6 docs:`fallback:true` 含义"**仅当无其他 highlighter 时才用**"。

我们注册 `markdownSyntaxHighlight` 后,default 整个 bail out。fenced code block 内 JS keyword / Python class 等 tag **拿不到 default 着色**(因为 fallback 整体 bail,不按 tag 逐个 resolve)→ **所有代码块单色**。

**修法**:去掉 `{ fallback: true }`,让 default 跟 markdown 平级共存。CM 按 tag 逐个 resolve:markdown 匹配 heading/strong/link 等,代码块内部语言 tag fallback default 上色。

**教训**:第三方库选项语义陷阱 — `fallback:true` 不是"按 tag 分级 fallback"而是"全或无 bail-out"。读 docs 时遇到布尔选项一定要确认作用范围。

### 坑 5:CSS cascade 决定 HighlightStyle 多规则胜负(矫正 ⑤ 第二步)

**现象**:去掉 `fallback:true` 后,代码块高亮恢复,但**所有 heading + link 出现下划线**!

**诊断**:default style 给 `tags.heading` 父 tag 加了 `textDecoration: underline`。lezer-markdown 节点同时 tag `[heading, heading1]`。两个 style class 都应用到 span,CSS 同 specificity,**注入位置后者赢** → default underline 赢。

我加 `{ tag: t.heading1, textDecoration: "none" }` 不生效,因为 CM6 把 default 的 class 注入位置**在我们之后**(实际 stylesheet 文本顺序)。

**修法**:用 `Prec.high()` 包装我们的 syntaxHighlighting → CM 让我们 style 的 CSS **后注入** → 我们 `textDecoration: none` 赢。

```ts
export const markdownSyntaxHighlight = Prec.high(syntaxHighlighting(markdownHighlightStyle))
```

跟矫正 ⑤ 第一步联动:default 已无 `fallback:true`,所以 Prec.high 不会让它 bail out。

**教训**:CodeMirror StyleModule 的 CSS 注入顺序由 extension precedence 决定,不是源码定义顺序。同 property 不同 style 冲突时,**用 Prec.high 翻 CSS cascade**。

### 坑 6:断言宽松通过了真问题(矫正 ⑤ 发现)

Playwright e2e spec 里测 "JS keyword line colors 至少 2 种" — text-base + text-weak 两种 gray 就够。但用户视觉看是单色!**我的断言阈值太松**。

修法:加 "非灰色 token" 筛选(R/G/B 差 > 15 算彩色)— 严格区分 default highlight 真彩色 vs 同色灰阶。

**教训**:e2e 视觉断言不能停在"有差异"层级,要**按用户视觉感知**精度做(色相 / 饱和度判断)。

### 坑 7:e2e mock 跟真 .app 是两套环境(矫正 ⑤ 发现)

我之前一直跑 Playwright e2e mock(vite dev server)做视觉验证。但真 .app 是 production tauri build + 嵌入 binary。**两套环境跑同份源码**,但状态不同 — e2e mock 用 dev server hot reload,bundle 不完整,某些懒加载语言可能没触发。真 .app 才是 user 体验的 ground truth。

**教训**:e2e mock 做 reactive / interaction smoke 够用,但**最终视觉验证必须真 .app + 真滚动**。

### 坑 8:Tauri WKWebView 内 SolidJS Portal menu button 接收不到合成 click(矫正 ⑦)

**现象**:cliclick / osascript click at / Python Quartz CGEventPost 三种 OS 层合成 click 事件,**全部打不到右键菜单 button 的 SolidJS onClick handler**(右键 menu 本身能弹出 — 说明 right-click 事件流通,只是 menu item 的 click 不通)。

**诊断**:SolidJS `<Portal mount={document.body}>` 把 menu 装到 document.body。Tauri WKWebView 把 native CGEvent 翻译成 web event 时,Portal 内 element 接收路径可能丢事件。这是 Tauri WebView 互操作的已知坑。

**Workaround**:加 Cmd+Shift+E 键盘快捷键直接调 `startEdit()`(`packages/app/src/pages/session/file-tabs.tsx` L789-806)— 既给 user 加便利,又**让以后 e2e 测试能键盘驱动**(键盘事件通过 WebView 正常)。

```ts
createEffect(() => {
  if (typeof window === "undefined") return
  const onKeyDown = (event: KeyboardEvent) => {
    if (activeFileTab() !== props.tab) return
    if (!(event.metaKey || event.ctrlKey) || event.altKey || !event.shiftKey) return
    if (event.key.toLowerCase() !== "e") return
    if (editing()) return
    if (!canEdit() || !state()?.loaded) return
    event.preventDefault()
    event.stopPropagation()
    void startEdit()
  }
  makeEventListener(window, "keydown", onKeyDown, { capture: true })
})
```

### 坑 9:Vite minifier `!=="e"` ↔ `==="e"` 反转(矫正 ⑦ 自我误判)

加完矫正 ⑦ 后 grep bundle `event.key.toLowerCase()!=="e"` **找不到**,误以为代码没编入。后来 grep `==="e"` 找到了 — minifier 把 `!== "e" return` 反转成 `=== "e"` 加正向逻辑保留代码。

**教训**:**minified bundle grep 要试两个方向**(`!==` 和 `===`)。

### 坑 10:用 cliclick `t:` 触发 Cmd+Shift+E 失败(GUI 自测路径)

`cliclick kd:cmd,shift t:e ku:cmd,shift` — `t:` 是 **type 字符模式**,在修饰键按下时 type 不发原始 keydown event。

**正确用法**:`cliclick kd:cmd,shift kp:e ku:cmd,shift` — `kp:` 才是 key press(发 keydown + keyup)。

## 自测路径(以后 markdown 编辑器调整怎么做)

### 路径 A:Playwright 自测(快速 reactive 验证)

```bash
cd packages/app
bun run dev:e2e-mock &
npx playwright test md-editing-iter-3-visual.spec     # 视觉断言
npx playwright test md-editing-iter-3-visual-tour     # 滚动截图 tour
```

- 输出:`e2e/test-results/iter-3-tour/view-NN.png`(15+ 张滚动捕获)
- 12-22s 全套完成
- **用途**:断言 heading 字号 / 颜色 / opacity 等可量化属性

### 路径 B:真 .app 自测(终极视觉验证)

```bash
# 1. build 最新 .app
pkill -9 -f "DeskFox Dev"; rm -rf packages/desktop/dist packages/app/dist packages/desktop/.turbo packages/app/.turbo
bash packages/branding/scripts/build-deskfox.sh -Env dev
cp packages/desktop/src-tauri/target/release/DeskFox \
   "packages/desktop/src-tauri/target/release/bundle/macos/DeskFox Dev.app/Contents/MacOS/DeskFox"

# 2. 隔离 user state(防干扰)
DEV_STATE=~/Library/Application\ Support/ai.deskfox.app.dev
mv "$DEV_STATE" "$DEV_STATE.tour-backup-$(date +%s)"
mkdir -p "$DEV_STATE"

# 3. launch + open file via 文件管理器(因 cliclick 打不到 portal menu)
open -n "/path/to/DeskFox Dev.app"
# 把 fixture 复制到 imbot-workspace 让 user 点击进入

# 4. user 手动 OR Cmd+Shift+E 进编辑模式

# 5. Python Quartz 滚动捕获
python3 << 'EOF'
import Quartz, time, subprocess
move = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, (800, 400), Quartz.kCGMouseButtonLeft)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, move)
for i in range(20):
    for _ in range(10):
        scroll = Quartz.CGEventCreateScrollWheelEvent(None, Quartz.kCGScrollEventUnitLine, 1, -4)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, scroll)
        time.sleep(0.02)
    subprocess.run(["screencapture", "-o", "-x", f"/tmp/page-{i:02d}.png"])
EOF

# 6. 恢复 state
rm -rf "$DEV_STATE" && mv "$DEV_STATE.tour-backup-..." "$DEV_STATE"
```

**关键约束**:
- **不能 cliclick 进编辑模式**(Tauri WKWebView + SolidJS Portal 限制)
- **可以 Cmd+Shift+E + 键盘进**(矫正 ⑦ 加的)
- **可以 Python Quartz 滚动**(scroll wheel 事件穿透 WebView 正常)
- **可以 screencapture**(系统级,不依赖 .app)

### 路径 C:bundle audit(确认代码真打进 binary)

```bash
# 验证 frontend bundle 含新代码
grep -oE '\.toLowerCase\(\)===?[!=]="[a-z]"' packages/desktop/dist/assets/session-*.js | sort -u
grep -oE '\{tag:Oe\.heading1,[^}]{0,200}' packages/desktop/dist/assets/session-*.js | head -1

# 验证 binary 嵌入 bundle
BIN="/path/to/DeskFox Dev.app/Contents/MacOS/DeskFox"
strings -- "$BIN" | grep -c "$(ls packages/desktop/dist/assets/session-*.js | xargs basename | sed 's/\.js$//')"
```

## 视觉验证档案(20 张)

`/tmp/iter3-final-shots/page-00.png` ~ `page-19.png`(2026-05-25 23:06,5120×2880 retina):

- **page-00**:顶部 h1 + 目录 TOC + 1. 标题层级 H1-H6 demo + 2. 文本样式开头
- **page-01**:任务列表 + 3.4 混合嵌套 + 4. 引用 + GitHub Alerts + 5. 代码 5.1/5.2
- **page-02**:**5.3 JS / 5.4 Python / 5.5 TS / 5.6 SQL / 5.7 Bash / 5.8 JSON** — 全部代码块语法高亮验证主战场
- **page-03**:6. 表格 + 7. 链接与图片 + 8. Mermaid Flowchart
- **page-04**:Mermaid 时序图 / 类图 / 甘特图 / 饼图 / 状态图
- **page-05**:9. 数学 + 10. 脚注定义列表 + 11. HTML 折叠块
- **page-06~19**:12. 组合排版示例各小节(Build 聊天面板自动展开,编辑区缩小,但内容字号梯度依然正确)

## R4 override 配额

本季(2026 Q2)第 1-2 笔:
1. `@lezer/highlight 1.2.3` direct dep(矫正 commit `f7b8c8bf8`):wrapper 不可行 — `HighlightStyle.define([{ tag }])` API 直接吃 Tag 对象引用
2. `@codemirror/lang-{python,sql,json,yaml,css} + lang-css` 6 个 direct deps(矫正 ⑥ commit `f9f15673b`):codeLanguages API 直接吃 LanguageDescription 对象;5 个包都是 @codemirror 官方;懒加载 0 启动 bundle penalty

配额超本季阈值(2 笔/季)— 本期 user 已授权(矫正 ⑥ 视觉割裂用户体验问题驱动)。

## 实施时长

约 6h(spec 调研 25 + plan 10 + 实现 20 + 测试 30 + 6 轮矫正 +120 + e2e spec/tour +60 + 真 .app 验证 +60 + 文档 +60),Medium 实际,符合"视觉调整 + 迭代踩坑"特征。

## 测试结果

| 项 | 结果 |
|---|---|
| `bun run typecheck` | 16/16 |
| 单元测试 `markdown-editor-extensions.test.ts` | 46/46(原 42 + 新 H1-H4 4)|
| Playwright e2e spec `md-editing-iter-3-visual` | PASS 12.9s |
| Playwright e2e tour `md-editing-iter-3-visual-tour` | PASS 22.4s,15 张视图全干净 |
| 真 .app 视觉验证 | PASS,20 张截图 `/tmp/iter3-final-shots/` 全干净 |

## 后续 backlog(留下次)

- **iter-3.1 lang-bash**:第三方 `@lezer/shell` 不主流,等官方 `@codemirror/lang-bash` 出 OR 自实现 lezer grammar
- **iter-3.2 mermaid 编辑态预览**:`@codemirror/lang-mermaid` 不存在,但可考虑用 `vite-plugin-mermaid` 风格 widget(光标进入 mermaid 块时显源码,离开 widget 渲染)— 这是 Live Preview 风,iter-3 spec 明确否决,留更远 backlog
- **CodeMirror outline panel**:大纲 / heading 跳转,跟 cm-status-bar 互补
- **Vim mode 可选**:`@codemirror/vim`,有用户需求时再加

## 回退方法

```bash
git revert <commits 6-13 范围>
```

或人工:
- `markdown-editor-extensions.ts` 删 `markdownHighlightStyle` + `markdownSyntaxHighlight` 两个 export
- `code-mirror-view.tsx` L33 改回 `syntaxHighlighting(defaultHighlightStyle, { fallback: true })`
- `lang-from-ext.ts` 删 6 个新 LanguageDescription
- `file-tabs.tsx` 删 Cmd+Shift+E keybind createEffect
- 测试文件删 H1-H4 段
- `package.json` 删 `@lezer/highlight` + 5 个 `@codemirror/lang-*`

回退后 markdown 编辑态回到 iter-2 行为(heading 字号无差异、单色 code block、所有 link 黑色无 underline / underline 都没有),其它语言文件视觉**0 影响**(generic code-mirror-view.tsx 不动 markdown 专属逻辑)。
