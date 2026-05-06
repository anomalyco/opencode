---
feat-id: md-export-pdf-word
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# md-export-pdf-word — changelog

**所在分支**: `feat/md-export-pdf-word`
**baseline**: `3a315f02f`(branch off dev)
**触发原因**: User 想把 .md 直接导出成 Word(.docx) / PDF — 用户不会用 markdown 工具,但 .md 是 OpenClaw 各 Agent 的核心载体,需要可分享给非技术人员的格式。详见 `1-spec.md`。

## 路线变更

| 阶段 | 决议 |
|---|---|
| v1 spec(2026-05-05) | 同时交付 PDF + Word |
| v1 实施 PDF | 失败 — Tauri 2.x macOS WKWebView `window.print()` silent(Wry 没实现 NSPrintOperation delegate,Tauri issue #5330) |
| 2026-05-06 决议 | drop PDF,只交付 Word(spec §9.6) |
| 转向"极致优化" | 6 项问题全攻坚(spec §9.7:A1 代码块 / A2 Mermaid / A5 本地图 / B1 emoji / B2 错误提示 / C1 选区显菜单) |
| v2 实测后根治(2026-05-06) | spec §9.7 6 项实施完后 user 实测发现新 bug,4 笔 commit 根治 |

## commit 列表(分支首末:`c2d3c0b25` → `ca28014a4`,共 17 笔)

### v1 准备(commit #1-#3)

| commit | 内容 |
|---|---|
| `c2d3c0b25` | docs spec 锁版 — 5 项需求 + 效果验收 P0 + PoC 强制前置 |
| `14cd84bc0` | docs plan + spec §9 PoC 后修订(换 markdown-docx,规模 200-350→~130) |
| `d557c3261` | chore deps 加 @jinzhongjia/markdown-docx@1.0.4(override-blacklist) |
| `950e9e786` | i18n 加 fileViewer.menu/dialog/toast 6 个 export 相关 key × 3 dict |

### v1 实施 + drop PDF(commit #4-#7)

| commit | 内容 |
|---|---|
| `2e576c9be` | 加 .md 导出 PDF helper(window.print + 动态注入 @media print)|
| `8690cf543` | viewer 右键菜单接入导出 PDF / Word(没选文字时显导出 / 选了仍显原菜单) |
| `74b321c06` | fix DOCX 导出 nodebuffer 错误 — toBuffer→toBase64String |
| `8ce9a3b35` | drop PDF 路线 v1 — Tauri WKWebView window.print silent 不可用 |

### v1 极致优化 6 项(commit #8-#13)

| commit | 内容 |
|---|---|
| `6124235d5` | B1 emoji 预处理 — 替换为文字符号防 Word 字体不含(后被 v2 推翻) |
| `6acad8505` | A2 Mermaid SVG → PNG 嵌入(从 viewer 拿渲染好的 SVG)|
| `1e742daf2` | A5 本地图片相对路径 → base64 dataURL 嵌入 |
| `151f6b6f9` | C1 选了文字也显导出菜单 — 原菜单底部加分隔 + 导出 Word |
| `5f7bfc4ad` | B2 错误友好提示 — 8 类常见错误中文化 |

### v2 实测根治(commit #14-#17,2026-05-06 用户实测后)

User 实测发现 5 类新 bug(spec §9.7 估值低估,真实根因更深),4 笔 commit 根治:

| commit | 内容 |
|---|---|
| `9fa923e87` | **A1 代码块切分根治** — single-paragraph + soft break + 修 inline code 误并 |
| `26fcba9ae` | **B1+ emoji 字体 fallback** — 删 EMOJI_MAP 改 splitRunsForEmoji |
| `e3ba2b656` | **A2 Mermaid 三连** — scale 2→3 + 5s 渲染等待 + foreignObject patch |
| `ca28014a4` | **C2 Replace 报错修** — write_binary_file_absolute_base64 加 allow_overwrite |

## v2 根治细节

### 笔 14 `9fa923e87` — A1 代码块切分根治

**原现象**:代码块在 WPS 中被切成多个独立 box(spec §9.7 A1 估"段间横线",实际是更深问题)。

**实测根因**(PoC 调试):库每行代码生成 1 个 `<w:p>`,首段 `pBdr=[top,l,r]` / 中段 `[l,r]` / 尾段 `[bottom,l,r]`。WPS 按"边框集合相同才合并 box"判断,首尾段集合不同 → 切成 N 个独立 box。

**解**:
- 加 `fflate@0.8.2` 解 docx zip
- `mergeCodeBlockParagraphs`:把每组连续 MdCode 段合并成 1 个 `<w:p>`,行间 `<w:br/>`,pBdr 改完整四边

**关联 bug**:
- 误并含 inline code 的列表项 — `isCode` 用全文 includes 命中字符样式 `<w:rStyle w:val="MdCode"/>`(inline code 反引号)。改用段落级 `<w:pStyle w:val="MdCode"/>` 精确匹配。
- 实测 README-MVP.md "心跳监控"段两条列表项(含 `\`sessions_spawn\`` / `\`HEARTBEAT_OK\``)被合并 + 套上代码块边框。

### 笔 15 `26fcba9ae` — B1+ emoji 字体 fallback

**原现象**:老 EMOJI_MAP(`6124235d5`)把 emoji + 普通 unicode 全替换成 ASCII 文字,后果两条:
1. ↓ → "v" 误像字母,严重误导(实测 user 报 README-MVP.md "调度官"段)
2. emoji → "[TARGET]" 又丑

**新方案**:保留所有原 unicode 字符,docx XML post-process 时把含 emoji 字符的 `<w:r>` 按"emoji vs 非 emoji"切分成多段,emoji 段 rFonts 改 `Segoe UI Emoji`(Win 内置;Mac fallback `Apple Color Emoji`)。

**效果**:🎯 红靶 / 🔬 紫显微镜 / 👿 紫魔 / 📊 柱状图 全部彩色显示。箭头 / ✓✗ 不再被替换 — 这些是普通 unicode 默认字体本就支持。

### 笔 16 `e3ba2b656` — A2 Mermaid 三连

**原现象**:test-mermaid.md 第 1 个流程图源码留为代码块,第 2 个序列图成 PNG。诊断 log 实证:
```
[0] hasForeignObject=true svgLen=18962 → pngs[0]: FAIL "operation is insecure"
[1] hasForeignObject=false svgLen=24323 → pngs[1]: OK len=158806
```

**实测根因**:mermaid v11.4 流程图 SVG 含 `<foreignObject>`(`htmlLabels:false` 在 v11 不严格生效)。WKWebView 转 image 时触发 tainted canvas → `toDataURL()` 抛 `SecurityError`。Chrome 不会(PoC 用 puppeteer 没复现)— **WKWebView 已知行为**。

**修 3 项**:
1. `scale` 2 → 3:retina + Word 200% 缩放下仍清晰,文件 ~2.25x
2. `inlineMermaidPngs` 加 5s 轮询等待(150ms/次)— 渲染慢的 mermaid 不再被错过
3. `svgToPngDataUrl` 内加 `patchForeignObjects`:clone SVG → 把 foreignObject 替换成 SVG `<text>`+`<tspan>` — viewer 显示用 HTML labels(美观),导出用 SVG text(WKWebView 兼容)

### 笔 17 `ca28014a4` — C2 Replace 修复

**原现象**:导出 Word 时选已存在文件名 → save dialog 弹"replace?" → 选 Replace → toast 报 `already_exists: /path/to.docx` + 文件未替换(数据风险)。

**根因**:`write_binary_file_absolute_base64` 是给文件拖入用的(commit #4 file-tree-dnd),故意校验"不存在"防止覆盖。导出复用此命令但 save dialog 已让用户确认替换。

**修**:rust 加 `allow_overwrite: Option<bool>` 参数(default false 保拖入语义不变),导出端 invoke 传 `allowOverwrite: true`。其他调用点不传 → 仍校验 already_exists,无回归。

## 行数

| 项 | 行数 |
|---|---|
| `packages/app/src/utils/md-export-docx.ts` 总(末态) | 489 行 |
| 新增 fork-only utils 库 | 全文件 fork-only |
| `packages/desktop/src-tauri/src/text_file.rs` 改 | +9 / -3 |
| v1+v2 累计 insertions(代码,本 feat 17 笔合计) | ~700+ 行 |
| 文档(本目录三件 + INDEX + 改动日志) | ~600 行 |

代码累计超规范 v2 的 500 阈值,但分摊到 17 笔 commit,单笔均在阈值内。无 large-diff override 标。

## 影响范围

- ✅ `.md` 文件查看器右键菜单加"导出为 Word"按钮(选区/无选区都显)
- ✅ Word 文档:中文 / 英文 / 标题层级 / 列表(含嵌套有序)/ 表格 / 引用 / 分隔线 / 粗斜删 / inline code / 链接 / 代码块(语法高亮)/ Mermaid 流程图 + 序列图(PNG 嵌入)/ 本地图片(base64)/ emoji(彩色字体 fallback)
- ⚠️ **已知不足**:
  - 嵌套引用 `> >` 不区分缩进(markdown-docx 库限制)
  - DeskFox 内置 viewer 预览自有 .docx 失败(LibreOffice 转 PDF 成功但前端渲染未触发)— 独立 bug,不在本 feat 范围,留下个 feat 修
- 🔒 **黑名单 override(R4)**:`9fa923e87` 一笔(`bun.lock` 自动重生,加 `fflate@0.8.2` dep,跟 `d557c3261` 同等场景,本季 R4 配额 +1)

## 回归测试

User 自测覆盖(2026-05-06 当日):

| 用例 | 结果 |
|---|---|
| 短代码块(2-4 行,plain + 语法高亮多语言) | ✅ 单一连续 box,边框 + 灰底 + 中英混排 + 语法着色 |
| 含空行 Python 代码块(def + print) | ✅ 单一连续 box,空行不切 |
| 长代码块(35 行) | ✅ 全部在一个 box |
| 含特殊字符 `< > & " '` | ✅ HTML 转义正确 |
| 末尾代码块(无 trailing 段)| ✅ 单一 box |
| 列表内嵌代码块 | ✅ 各自完整 box |
| 空代码块 ``` ``` | ✅ 空 box,不崩 |
| 整文档仅代码块 | ✅ 单一 box |
| 含 inline code 的列表项(README-MVP "心跳监控")| ✅ 4 个 MdListItem 独立段,无错误合并 |
| Mermaid 流程图(13 节点)| ✅ PNG 嵌入,中文文字保留,foreignObject 已转 SVG text |
| Mermaid 序列图(4 角色)| ✅ PNG 嵌入,时间线箭头 + 中文消息全对 |
| emoji 渲染(🎯🔬👿📊)| ✅ 彩色显示(macOS WPS 上 fallback Apple Color Emoji)|
| 箭头 ↓ → ← ↑ + ✓ ✗ | ✅ 原 unicode 字符显示,不再替换成 ASCII |
| 文件覆盖(Replace) | ✅ allow_overwrite=true,无 already_exists 报错 |
| Markdown 综合元素(标题 H1-H6 / 嵌套列表 / 表格 / 引用 / 分隔线 / 粗斜删 / inline code / 链接) | ✅ 全部正确渲染 |
| 真实长文档(UPSTREAM-MERGE-GUIDE 296 行)| ✅ 5 页全过,代码块 + 表格 + 列表 + 链接 + 中英混排无回归 |

PoC 沙盒(`/Volumes/ExtSSD/turbodocx-poc/`)用 4 个测试集(TC1 代码块边界 / TC2 综合 markdown / TC3 真实长文档 / TC4 边界 case 5 项)累计 ~20 个独立场景验证。

## 回退方法

每笔 commit 独立可 revert(P4):
- 不要 emoji 字体 fallback(回到 ASCII 替换):`git revert 26fcba9ae`
- 不要 Mermaid 矢量优化(回 v1 PNG 路径):`git revert e3ba2b656`
- 不要代码块切分根治(回 v1 横线现状):`git revert 9fa923e87`(注:同时回滚 fflate 依赖)
- 不要 Replace 修复:`git revert ca28014a4`(回到 already_exists 拦截)

整 feat 回退:`git revert c2d3c0b25..ca28014a4`(17 笔)。

## 涉及文件汇总

### 代码

| 文件 | 角色 |
|---|---|
| `packages/app/src/utils/md-export-docx.ts` | 主 helper(489 行,fork-only)— mergeCodeBlockParagraphs + splitRunsForEmoji + svgToPngDataUrl/patchForeignObjects + inlineMermaidPngs/inlineLocalImages + exportMdAsDocx + friendlyError |
| `packages/app/src/pages/session/file-tabs.tsx` | viewer 右键菜单接入 onExportDocx + 选区状态判定 |
| `packages/desktop/src-tauri/src/text_file.rs` | `write_binary_file_absolute_base64` 加 allow_overwrite |
| `packages/app/package.json` + `bun.lock` | 加 `@jinzhongjia/markdown-docx@1.0.4` + `fflate@0.8.2` |
| `packages/app/src/i18n/{en,zh,zht}.ts` | 6 个 fileViewer.menu/dialog/toast key |

### 文档

- `docs/features/md-export-pdf-word/{1-spec,2-plan,3-changelog}.md`(本目录)
- `docs/features/INDEX.md`(加索引行)
- `改动日志.md`(加索引)
