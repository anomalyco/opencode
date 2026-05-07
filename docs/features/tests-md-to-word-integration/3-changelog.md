---
feat-id: tests-md-to-word-integration
status: done
related: ./3-changelog.md
---

# 3-changelog — MD → Word 端到端集成测试(基础设施实证)

## 起源

D 系列 + e2e 基础设施全部完成后,user 提议:**用配置好的基础设施完成一个真实测试,如 MD 转 Word**。

这是基础设施的**真实价值实证** — 之前只测了 8 个 helper 纯函数,主入口 `exportMdAsDocx` 端到端流程从没真测过。本笔补完最后一块拼图。

## 测试范围 — 真实 MD → docx blob 全流程

```
markdown 字符串
  → inlineMermaidPngs(viewerEl,可空)
  → inlineLocalImages(mdFileDir,可空)         ← 复用 D4 invoke mock
  → markdownDocx 库(真跑,marked + docx@9.x)
  → Packer.toBase64String(序列化)
  → unzipSync(zip 拆包)
  → mergeCodeBlockParagraphs(D2 已 unit 测,这里跑真路径)
  → splitRunsForEmoji(D2 已 unit 测,这里跑真路径)
  → zipSync(重打包)
  → invoke("write_binary_file_absolute_base64", ...)  ← D4 mock 拦
  → showToast(success / fail)                  ← mock
```

**Mock 的**:`@tauri-apps/api/core` invoke / `@opencode-ai/ui/toast` showToast / 测试传入 saveDialog
**真跑的**:markdown-docx / docx 库 / fflate / 所有 fork helper

## 改动清单

### 新文件 — `md-export-docx-integration.test.ts`(~230 行 / 11 测试)

| 测试 | 重点 |
|---|---|
| **取消 save 对话框** | saveDialog 返 null → 静默退出 / 0 invoke / 0 toast |
| **简单 md 完整流程** | invoke 调用次数 / 命令名 / 参数(path / allowOverwrite=true / base64Content 长度)/ success toast |
| **生成 docx 是合法 zip** | 解压 docx,验证含 `word/document.xml` + `[Content_Types].xml` + 标题文本嵌入 |
| **defaultFileName 拼 .docx** | saveDialog 收到 `${name}.docx` |
| **i18n.title 传到 dialog** | dialog 标题正确 |
| **invoke 失败 → friendlyError toast** | EACCES → "无写入权限" + [详细] 段保留原文 |
| **代码块 → mergeCodeBlockParagraphs 触发** | docXml 含 `<w:br/>` 软换行 + `w:val="MdCode"` 段落样式 |
| **emoji md → splitRunsForEmoji 触发** | docXml 含 "Segoe UI Emoji" 字体 + emoji 字符保留 |
| **无 mdFileDir → 跳过本地图替换** | 0 个 read_binary_file_base64 调用 |
| **有本地图 + mdFileDir → inlineLocalImages 走 invoke** | read 1 次(读图)+ write 1 次(写 docx)|
| **不带 viewerEl → mermaid 块保留** | 不抛错,success toast 出 |

## 测试结果

```
$ bun test src/utils/md-export-docx-integration.test.ts
11 pass / 0 fail (37 expect calls / 989ms)

$ bun run test:unit (full suite)
542 pass / 1 fail(kobalte 老坑无关)
531 → 543 (+11 全 pass);typecheck 15/15
```

## 踩坑

### 坑:syntax 高亮把 `const a` 切成多 token

首版 assert `expect(docXml).toContain("const a")` fail。原因:markdown-docx 库的 `codeHighlight: { enabled: true, theme: "github-light" }` 把代码按 token 切成多个 run,每个 token 单独包 `<w:r>` + 不同颜色 `<w:rPr>`,所以 docXml 里 `const`、` `、`a` 是 3 段独立 run,不是连续字符串。

修:assert `>const<` / `>a<` / `>b<` / `>c<`(token 单独存在)+ `<w:br/>`(行间软换行)+ `w:val="MdCode"`(段落级样式)。这反而验证了**真实的 syntax 高亮工作了**,比连续字符串 assert 更有价值。

### 噪音(非 fail):markdown-docx 试图 fetch dataURL 图

```
[MarkdownDocx] Failed to download image from ./local.png: ENOENT
[MarkdownDocx] Failed to download image from data:image/png;base64,FAKE_PNG_BASE64: ENOENT
```

markdown-docx 库收到 dataURL 后还是尝试 fs.open 它(库 bug 或 happy-dom 模拟环境路径解析不准)。**测试不 fail**(库 swallow 这种错保留原 path),只是 stderr 输出,可以忽略。

## 基础设施实证价值

本笔证明了 D 系列建好的基础设施工作正常:

| D 系列设施 | 本笔用法 |
|---|---|
| **D4 Tauri invoke mock** | mock 2 个 invoke(read_binary_file_base64 + write_binary_file_absolute_base64),`invokeImpl` 可变控制各场景 |
| **D2 helper extract** | `mergeCodeBlockParagraphs` / `splitRunsForEmoji` 之前 unit 测过,本笔跑真路径验证 |
| **D4 inlineLocalImages 100% 覆盖** | 本笔再做上层集成验证(配 mdFileDir 时真调用 invoke) |
| **showToast mock** | 复用 mock.module 模式 mock 上游 toast 库 |

**复用 + 累加**模式:D 系列建的基础设施 + 本笔再叠加(saveDialog 控制 / showToast mock) → 11 个端到端测试。

## V2 双清单状态推进

| Logic 清单 | 之前 | 本笔后 |
|---|---|---|
| `md-export-docx.ts` | ~100% helper coverage | **~100% helper + 端到端流程也覆盖** ⬆ |

`md-export-docx.ts` 是 Logic 清单中**第一个达到"helper + 集成"双层覆盖**的文件,可作为后续 utility 测试的范本。

## 规模 / R 标记

- 规模:Medium(~230 行测试 / 1 文件 / 0 R4 / 0 上游侵入)
- R2 FORK marker:✓
- R3 黑名单:无
- R4 override:无
- R5 测试纪律:本 feat 是测试,自然满足

## 后续 follow-up(backlog)

- `markdown-editor-extensions.ts` 异步路径(handleImageDrop / readFileAsBase64)用同样模式补 → 推到 80%
- 给其他 utility 文件(`local-asset.ts` / `mention.ts` 等)按本笔范本加集成测试
- View 清单的真 e2e 启动(dialog-settings.tsx / file-tabs.tsx)
