---
feat-id: md-export-word-iter-2
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# md-export-word-iter-2 — changelog

**所在分支**:`dev`(直接在 dev,迭代式 commit 待补;改动量 Large 但都在工作树)
**baseline**:`7eb3200ac`(本轮起点)
**触发原因**:实战测试 `markdown-test.md` 综合文档,发现 v1 导出有 ~25 个保真度问题(HTML 标签、Alerts、图片、数学、表格、目录跳转 等)。详见 `1-spec.md`。

## Commit 列表

本 feat 共 6 笔实施 commit + 1 merge commit + 1 release bump commit:

```
185ad127c  feat(desktop): 加 fetch_url_base64 命令 — 远端图片走后端 reqwest 绕 WebView2 CORS
194172129  chore(deps): 加 katex@0.16.45 + mathml2omml@0.5.0 — 数学公式 LaTeX→MathML→OMML  [override-blacklist]
f5b22a840  feat(ui): viewer marked 扩展 — <mark>/GFM emoji/heading anchor/嵌套 link 图片  [override-blacklist]
a8030f1f3  feat(md-export-word): iter-2 全面保真度提升 — HTML 标签/Alerts/blockquote/图片/表格/数学/目录跳转  [large-diff]
bfb6ca503  test(md-export-word): iter-2 helper 全覆盖 — 单测 72 → 147  [large-diff]
b2740f19a  docs(features): md-export-word-iter-2 三文档 + 索引(规范 v2 Large 改动)
ae96d138b  Merge feat/md-export-word-iter-2 into dev
a9072d384  chore(release): bump Windows installer 2026.5.9.1
```

**Release**:[ship-prod-2026.5.9.1](https://github.com/zoulukuang/deskfox/releases/tag/ship-prod-2026.5.9.1) (GitHub) / [Gitee 镜像](https://gitee.com/zoulukuang/deskfox/releases/tag/ship-prod-2026.5.9.1)
- Installer:`DeskFox-2026.5.9.1-setup.exe`(58.15 MB / 60,978,467 bytes)
- SHA256:`3C79209005D28EBFD621CC806313ECE614054CEF1745C3D1819C467EE6B7D2D9`
- Build 路径:GitHub Actions 两次 60min timeout(根因待查),最终走**本地 build + `gh release create` 上传** + Gitee mirror 闭环

## 改动文件

| 文件 | 行数 | 性质 |
|---|---|---|
| `packages/app/src/utils/md-export-docx.ts` | +~1500 | 主 helper 集合(~15 个新 helper + sentinel 常量) |
| `packages/app/src/utils/md-export-docx.test.ts` | +~900 | 13 类新 helper 单测,从 72 → 147 |
| `packages/ui/src/context/marked.tsx` | +~150 | viewer 侧 mark / emoji / heading anchor / 嵌套 link 扩展 |
| `packages/desktop/src-tauri/src/text_file.rs` | +36 | 新命令 `fetch_url_base64` |
| `packages/desktop/src-tauri/src/lib.rs` | +1 | 注册命令 |
| `packages/app/package.json` | +deps | +`katex@0.16.45` +`mathml2omml@0.5.0` +`@types/katex@0.16.8`(devDep) |
| `bun.lock` | varied | 依赖 lockfile |
| 新增 `docs/features/md-export-word-iter-2/{1-spec,2-plan,3-changelog}.md` | +~600 | 三文档 |
| 新增需求池 deferred:`OPENCODE-PLAN/需求池/md-export-word-积分占位符.md`、`save-dialog-默认按钮.md` | +~150 | 已知问题归档 |

## 影响范围

- **导出 .docx 路径**:核心改动 — 视觉与功能全面提升
- **MD viewer**:`<mark>` / GFM emoji / heading anchor / 嵌套链接图片
- **后端**:多 1 个 Tauri 命令(reqwest fetch URL)
- **依赖**:净加 ~1MB(katex + mathml2omml,gzip 后)
- **零回归**:所有 v1 已 work 的功能(代码块、emoji 字体、列表、headings、普通段落)未触动

## 主要 helper 一览

### 预处理 markdown(`preprocessMarkdown` + 子函数)
- `preprocessMarkdown` — 主入口,串各步骤
- `wrapBlockquoteBlocks` — 给独立 blockquote 块前后加 sentinel(GFM Alerts 用 type-specific OPEN)
- `toUnicodeSup` / `toUnicodeSub` — `<sup>`/`<sub>` 转 Unicode 上下标
- `normalizeHex` — `#fff` → `FFFFFF`(用于 span 颜色解析)
- 内联 sentinel 替换:`==高亮==` 用 BADGE / `<u>` 用 UND / `<div align>` 用 CENTER / GFM Alerts 用 QUOTE_OPEN_<TYPE>

### 后处理 docx XML(`apply*` 系列)
- `mergeCodeBlockParagraphs` — 代码块多段合并(v1 已有)
- `styleInlineCode` — 去 inline code 下划线 + 加薄荷绿底
- `applyUnderlineSentinels` — `<u>` sentinel → 下划线 run
- `applyColorBadgeSentinels` — `<span style>` sentinel → shd + color
- `applyCenterSentinels` — `<div align>` sentinel → `<w:jc w:val="center"/>`
- `applyBlockquoteGroups` — sentinel 边界识别 group + 删 MdSpace + 给 BQ 段加 pBdr/shd 颜色 + 表格保留
- `applyTableBorders` — 6 边全表格框
- `applyTableHeaderShading` — header cell 浅灰底
- `applyTableSpacing` — 表格前后插 spacer 段
- `applyMathSentinels` — sentinel → `<m:oMath>` / `<m:oMathPara>`,docx root 加 m: 命名空间
- `applyHeadingBookmarksAndAnchors` — heading 加 bookmark + #anchor 链接转 internal w:anchor + 改 _rels
- `splitRunsForEmoji` — emoji 字符给 emoji 字体(v1 已有)

### 数学公式辅助
- `latexToMathML` / `mathmlToOmmlString` — KaTeX + mml2omml 转换
- `slugifyHeading` / `slugToBookmarkName` — heading slug + OOXML bookmark name 规则适配

### 图片管道辅助
- `parsePngSize` / `parseJpegSize` / `parseGifSize` — 字节头解析尺寸
- `sniffImageMime` — 字节头 sniff mime
- `convertImageBytesToPng` — SVG/WebP 经 canvas 转 PNG
- `buildImageAdapter` — 提供给 markdown-docx 的 imageAdapter 实现
- `inlineLocalImages` / `inlineMermaidPngs` — 本地 + mermaid(v1 已有,本轮 mermaid 加 CENTER sentinel 居中)

## 测试

- 单测:147 个(从 72 起步,加 75 个),`packages/app/src/utils/md-export-docx.test.ts`
- 集成:11 个,`md-export-docx-integration.test.ts`(用 mock invoke + 真 markdown-docx 库跑端到端)
- typecheck:全 monorepo 通过
- 手测:`Downloads/markdown-test.md` 综合文档全要素 user 验证 OK

## 回归测试

- ✅ Word 打开 markdown-test.docx 不弹修复对话框
- ✅ Word 打开后所有节渲染 OK(包括 12.x 复杂混排)
- ✅ Ctrl+点击目录链接跳转
- ✅ 数学公式可点击进入 Word 公式编辑模式
- ✅ 图片成功嵌入(7.2 节 placehold.co + 12.1 节 8E44AD 占位图)
- ✅ Mermaid 6 张图都嵌入 + 居中
- ✅ MD viewer 自身渲染:`==高亮==` 黄底 / `:rocket:` emoji / `[![]()](url)` 嵌套图片 / 目录跳转

## 已知遗留(deferred)

- **数学公式 ∫ 占位框** — `mml2omml` 转换 bug,`\int_0^∞` 等 nary 转 OMML 时 `<m:e>` 留空,Word 显占位虚线框。Backspace 可删。详见 `OPENCODE-PLAN/需求池/md-export-word-积分占位符.md`
- **save dialog 覆盖确认默认在"否"** — Tauri-plugin-dialog native Windows 限制。详见 `OPENCODE-PLAN/需求池/save-dialog-默认按钮.md`

## 回退方法

如果生产环境出现意外问题:
1. revert 本轮 commits(待 commit 后填具体 hash)
2. 或工作树:`git checkout -- packages/app/src/utils/md-export-docx.ts packages/ui/src/context/marked.tsx packages/desktop/src-tauri/src/{text_file,lib}.rs packages/app/package.json bun.lock`
3. `bun install` 还原 deps(去 katex + mathml2omml)
4. 影响 = 回到 v1 行为,导出仍可用但保真度下降

## 状态
done(2026-05-08)
