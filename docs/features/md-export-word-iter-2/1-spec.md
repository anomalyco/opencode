---
feat-id: md-export-word-iter-2
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# md-export-word-iter-2 — spec

## 背景

[`md-export-pdf-word`](../md-export-pdf-word/) (v1) 已交付基础 .md → .docx 导出能力,但实战验证(2026-05-08 user 用 `markdown-test.md` 综合测试文档跑全要素)发现大量保真度问题:HTML inline 标签原文输出、GFM Alerts 显示 `[!NOTE]` 字面、远程图片打不开、表格无内框、blockquote 拆段、数学公式显示 LaTeX 源、emoji shortcode 不识别、目录链接不跳转 …… 共 ~25 个具体问题。

本次 iter-2 是**全面保真度提升**,目标:让 markdown-test.md 这种"测渲染器极限"的综合文档,导出 Word 后视觉与 viewer 接近,功能(数学公式可编辑、目录可跳转)与 Word 原生文档对齐。

## 目标

| 维度 | 目标 |
|---|---|
| HTML 标签 | `<u>` / `<sup>` / `<sub>` / `<kbd>` / `<span style>` / `<div align>` / `<details>` / `<img>` / `<p align>` 都正确转 Word 元素 |
| GFM Alerts | `> [!NOTE]/[!TIP]/[!WARNING]/[!CAUTION]/[!IMPORTANT]` 5 类各有独立颜色块(对齐 GitHub viewer 配色) |
| Blockquote 多段 | 同一引用块内多段视觉一体(连续左竖线 + 浅底色),不同 blockquote 之间视觉独立 |
| 图片 | 本地 + 远程 + SVG/WebP 都能嵌进 Word(直接二进制嵌,非外链) |
| 表格 | 全 6 边框 + header 灰底 + 上下空行 |
| Mermaid | viewer 已渲染的 SVG → PNG 居中嵌入 |
| 数学公式 | LaTeX → Word 原生 OMath(可编辑、矢量、跟随字号) |
| 字号 / 行距 | 跟随 Word default(11pt + 1.15) |
| 目录跳转 | `[文](#anchor)` 在 Word 内 Ctrl+点击跳转 |
| Emoji | viewer + Word 都支持 GFM `:rocket:` 等 shortcode + Unicode emoji |
| 高亮 | `==高亮==` viewer + Word 都黄底显示 |

## 非目标

- 不追求 1:1 复刻 viewer 视觉(如表格内嵌入引用 — OOXML 不支持)
- 不修 v1 已经 OK 的部分(代码块 / 普通文本 / emoji 字体)

## 验收标准

`Downloads/markdown-test.md` 这份综合文档导出 Word 后:

1. 11.5 颜色徽章("成功 警告 失败")— 字带底色,中间有间距
2. 4. 引用 节 — 6 个独立引用块,各自颜色(普通灰、Note 蓝、Tip 绿、Warning 黄、Caution 红)
3. 7.2 图片节 — placehold.co 远程图片成功嵌入(不是 `[Image failed to load]`)
4. 8. Mermaid 节 — 6 张图都正确嵌入 + 居中
5. 9. 数学公式节 — 公式是 Word 原生 OMath,Ctrl+点击可编辑
6. 11.4 表情符号节 — `:rocket:` 等 shortcode 显示彩色 emoji
7. 11.6 居中文字 节 — `<div align="center">` 内段落居中
8. 12.x 节 — blockquote 内嵌入表格、列表、混合排版正常
9. 目录(开头大列表) — Ctrl+点击跳到对应章节
10. Word 打开**不弹修复对话框**(docx XML 完全合法)

## 架构选型

### 总策略:Sentinel 占位 + 后处理 docx XML

库(`@jinzhongjia/markdown-docx`)对许多 markdown 语法不支持(HTML 标签、GFM Alerts、math、details 等)。直接改库源码侵入大、版本升级难。**采用前后双夹策略**:

- **预处理 markdown**(`preprocessMarkdown`):把库不支持的语法转成"库能处理的近似形式"或"sentinel 占位字符"(Unicode PUA 字符,marked 透传当文本)
- **库正常处理 markdown** → docx
- **后处理 docx XML**:扫 sentinel 占位段,替换为对应 OOXML 元素(如 `<m:oMath>` / `<w:bookmarkStart>` / `<w:hyperlink w:anchor>`),改 cell shading / pBdr / spacing 等属性

这套架构让我们用 ~10 个独立 helper 函数(单测覆盖)解决了所有大类问题,无需 fork 库。

### 数学公式路径(决策点)

走过三条路:

1. **❌ KaTeX HTML → SVG foreignObject → PNG**:WebView2 canvas tainted(KaTeX webfont 跨域)
2. **❌ MathJax SVG → PNG**:能跑但输出是图片(不可编辑、尺寸难控、矩阵渲染异常)
3. **✅ KaTeX MathML → mml2omml → 嵌入 docx OMML**:Word 原生公式,可编辑 + 矢量 + 跟随字号

路径 3 是工业级正解。代价:加 2 个 npm 包(katex + mathml2omml)。

### Blockquote group 路径(决策点)

库把不同 blockquote 的段铺平输出 + 中间插 MdSpace 段,丢失 blockquote 边界。无法用"连续 MdBlockquote 段"识别 group。

**采用 sentinel 边界标记**:`wrapBlockquoteBlocks` 给每个独立 blockquote 块前后插单独段(含 PUA 字符 sentinel),`applyBlockquoteGroups` 后处理时按 sentinel 识别 group 边界 → 删 sentinel + Space + 给 BQ 段加 type-specific pBdr/shd。

### 表格嵌引用块(妥协)

OOXML `<w:tbl>` 是 body 顶层元素,与 `<w:p>` 同级,**无法嵌套在段落容器内**。viewer 的"BQ 内嵌表格"视觉效果无法 1:1 复刻。

**决策**:接受现实 — 表格在 group 内独立显示(前后 BQ 段保持灰底),表格本身用 native 边框样式。

### 数学公式占位框(已知 deferred)

`mml2omml` 库 bug:KaTeX `\int_0^∞` 转 OMML 时 `<m:nary>` 的 `<m:e>` base 留空,Word 渲染显示"待输入"虚线占位框。3 次修补尝试(rewrite to sSubSup / 吃 sibling 进 m:e / 空 run 填充)均让 docx XML 不合法。

**决策**:接受作为已知小瑕疵,user 在 Word 内 Backspace 可手动删除。详见 `OPENCODE-PLAN/需求池/md-export-word-积分占位符.md`。

## 改动范围预估

| 文件 | 估改 |
|---|---|
| `packages/app/src/utils/md-export-docx.ts` | +1500 行(主 helper 集合) |
| `packages/app/src/utils/md-export-docx.test.ts` | +900 行(13 个新 helper 各自单测) |
| `packages/ui/src/context/marked.tsx` | +150 行(viewer 侧 emoji / mark / heading anchor 扩展) |
| `packages/desktop/src-tauri/src/text_file.rs` | +36 行(新命令 `fetch_url_base64`) |
| `packages/desktop/src-tauri/src/lib.rs` | +1 行(注册命令) |
| 依赖 | +`katex@0.16.45` +`mathml2omml@0.5.0` (两包必须) |

按 v2 分级 = **Large**(>500 行 + 多文件)。

## 依赖增加论证

- **`katex`**:LaTeX → MathML 渲染。无替代(MathJax 重 5MB,且我们不要 SVG)
- **`mathml2omml`**:MathML → OMML 转换。无成熟替代(`mathml-to-omml` 不存在;Microsoft 官方 XSL 不能在 WebView2 跑)
- **bundle 增量**:~1MB(katex 600KB + mathml2omml 200KB,gzip 压缩后)

可接受,因为是核心功能。

## 状态
done(2026-05-08)
