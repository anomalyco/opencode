---
feat-id: md-export-word-iter-2
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# md-export-word-iter-2 — plan(实施轨迹)

## 总体策略

每发现一个 user 反馈的具体 bug → 调研根因(读库源码 / dump XML)→ 决策 sentinel/post-process/直接 lib 配置 → 实施 + 单测 + build → user 测,反馈,迭代。

## 实施时间线(主要决策点)

### Phase 1: 预处理 + 后处理 sentinel 框架

- 新建 `preprocessMarkdown` + 各种 `apply*Sentinels` post-process helper
- HTML 标签处理:`<u>` / `<sup>` / `<sub>` / `<kbd>` / `<details>` / `<img>` 转 markdown 等价
- `==高亮==` → BADGE sentinel(预处理) + applyColorBadgeSentinels(后处理给 run 加 shd)

### Phase 2: GFM Alerts 6 类彩色

**走过弯路**:
- v1 把 `[!NOTE]` 转成 `**📌 Note**` 中文标签 — user 反馈"不要翻译"
- v2 改回英文 `Note/Tip/Warning/Caution/Important`

**最终方案**:
- preprocess `wrapBlockquoteBlocks` 给每个独立 blockquote 块前后插 sentinel(type-specific OPEN + 通用 CLOSE)
- post-process `applyBlockquoteGroups` 按 sentinel 边界识别 group,删 sentinel 段 + 删内部 MdSpace 段 + 给 BQ 段加 pBdr/shd 颜色

### Phase 3: Blockquote group 视觉一体

**根因调研**(写 debug 脚本 dump 实际 docx XML):库每段 BQ 后插一个 MdSpace 空段做"段间气垫",制造垂直 gap → 左竖线不连续。

**修法**:在 `applyBlockquoteGroups` 内,group 内的 MdSpace 段一并删除;BQ 段加 inline `<w:spacing w:before="0" w:after="0"/>` 强制覆盖 style 继承。

### Phase 4: 表格全边框 + header 灰底

`applyTableBorders` 强制注入 `<w:tblBorders>` 6 边(top/left/bottom/right + insideH + insideV);`applyTableHeaderShading` 给含 `MdTableHeader` pStyle 的 cell 加 `<w:shd>` 浅灰 #F6F8FA。

### Phase 5: 表格在引用块内(妥协)

OOXML `<w:tbl>` 是 body 顶层元素,**不能嵌套在 `<w:p>` 内**。尝试:
- 改 tblBorders.left 为 BQ 颜色 + tblInd 对齐 BQ pBdr.left → 视觉接近但不完美
- user 看到效果"还是不舒服"

**决策**:回退,group 内表格原样 + 前后插 spacer 段隔开,接受 OOXML 限制。

### Phase 6: 图片走 Tauri reqwest + imageAdapter

**走过弯路**:
- v1 试把 https → data: URL 让库自己 fetch — WebView2 CSP 拦了 fetch(data:)
- v2 用库的 `imageAdapter` option 直接喂 bytes,不依赖库 fetch

**最终**:
- 后端加 `fetch_url_base64` Tauri 命令(reqwest + 8MB 上限 + 10s 超时)
- 前端 `buildImageAdapter`:sniff 字节头判 mime → PNG/JPEG/GIF/BMP 直接喂库 / SVG/WebP 经 canvas 转 PNG
- PNG/JPEG/GIF 自解头取 width/height(`parsePngSize` / `parseJpegSize` / `parseGifSize`)

### Phase 7: 数学公式三轮迭代

**第 1 轮 — KaTeX HTML → SVG → PNG(viewer DOM 抓)**:
- 从 viewer 抓 .katex / .katex-display 元素 → 包 SVG foreignObject → canvas → PNG
- 失败:WebView2 canvas tainted(KaTeX webfont 跨域)

**第 2 轮 — MathJax SVG → PNG**:
- 装 mathjax-full(~5MB),用 liteAdaptor 渲染 LaTeX → SVG → canvas → PNG
- 部分 work:简单公式 OK,但矩阵渲染异常 + 输出图片不可编辑

**第 3 轮(✅ 采用)— KaTeX MathML → mml2omml → 嵌入 docx OMML**:
- user 提示"如果 Word 支持 LaTeX 为什么还要转化呢" — 启发查 OMML 路径
- 实施:preprocess 阶段 LaTeX → MathML(KaTeX)→ OMML(mml2omml),用 sentinel 占位
- post-process `applyMathSentinels` 把含 sentinel 的段替换成 `<m:oMathPara>`(块) / `<m:oMath>`(行内),docx root 加 `xmlns:m`
- 卸 mathjax-full,装 katex + mathml2omml(净 dep ~-3MB)

**已知 deferred**:`\int_0^∞` 等 nary 转 OMML 后 `<m:e>` 留空,Word 显占位框。详见需求池。

### Phase 8: 目录跳转(bookmark + internal hyperlink)

**走过弯路**:
- v1 regex `[^/]` 误吞 `Type="http://..."` URL 中的 `/`,_rels 解析失败
- v2 regex 修后,bookmark id 复用同 slug 导致 duplicate id → Word 拒打开
- v3 bookmark id 永远递增 + name 重名加 `-N` 后缀,但 OOXML schema 要求 name 以 letter 开头(我的 slug `1-标题层级` 数字开头)→ Word 修复后 name 改了
- v4(✅) name + anchor 都加 `h_` 前缀(letter 开头)+ 截 40 字符
- v5(最后)发现 `<w:hyperlink r:id>` 的 r:id 不一定是第一 attribute(库出 `<w:hyperlink w:history="1" r:id="...">`),改 attribute-based 提取

### Phase 9: viewer 侧补缺

- ==高亮== → `<mark>`(自定义 marked extension)
- GFM emoji shortcode `:rocket:` → 🚀(自定义 marked extension + 80+ 字典)
- 嵌套 `[![]()](url)` 链接图片 — link renderer 用 `parser.parseInline(tokens)` 而非 raw text
- heading 自动生成 GFM-style anchor id(支持中文,与 viewer + Word bookmark 对齐)

### Phase 10: 字号 / 行距对齐 Word default

库 documentDefault 字号 24(12pt),Word default 22(11pt);行距 lineRule="auto" 无 line value。
monkey-patch 改 `default.document.run.size = 22` + `paragraph.spacing = { line: 276, lineRule: "auto" }`(1.15 倍 = 276 twips)。

### Phase 11: BQ 默认斜体关掉

库 `markdown.blockquote.run.italics = true` 让所有引用文字自动斜体。user 反馈"不要统一斜体"。
monkey-patch 关 `.italics = false`(显式 `*italic*` 走独立 em token,不受影响)。

### Phase 12: inline code 改背景色

库 hardcode 给 codespan 加 underline 而不带背景。post-process 找 rPr 含 MdCode + 下划线的 run(只 inline code 有 underline,代码块 run 无),去 underline + 加 `<w:shd w:fill="D4EDDA">` 薄荷绿底色。

## 关键调试技巧

1. **dump 实际 docx XML**:写 debug script,跑全 pipeline 后 dump `word/document.xml` + `word/_rels/document.xml.rels` 到 `D:/tmp/`,用 Python/grep 看具体 OOXML 结构 — 多次发现根因(MdSpace 气垫、`<m:nary>` 空 base、_rels regex bug)
2. **test fixture 唯一 marker**:测试时用 `P1MARKER` / `P2MARKER` 等独特字符串,避免与其他属性内容冲突(`indexOf("after")` 误命中 `w:after="0"` 那次)
3. **OOXML schema 顺序敏感**:`<w:pPr>` 内子元素必须按 `pStyle → pBdr → shd → spacing → ind → jc` 顺序,Word 对乱序部分忽略(踩过)
4. **bookmark name 限制**:必须 letter 开头 + 最长 40 字符 + 不允许 hyphen / 中文(实测 Word 宽容中文 + hyphen,但必须 letter 开头)

## 决策档案

| 决策 | 时间 | 理由 |
|---|---|---|
| GFM Alerts 不翻译用英文 | 2026-05-08 | user 反馈 |
| 表格在 BQ 内不强 hack 视觉 | 2026-05-08 | OOXML 限制,强 hack 效果违和 |
| 数学公式 deferred ∫ 占位框 | 2026-05-08 | mml2omml 库 bug,3 次修补失败,Backspace 可删 |
| save dialog 默认按钮 deferred | 2026-05-08 | Tauri-plugin-dialog native 限制,fork 工程量大 |
| 走 OMML 而非 SVG/PNG | 2026-05-08 | user 启发"Word 支持 LaTeX",OMML 是 Word 原生公式格式 |

## 状态
done(2026-05-08)
