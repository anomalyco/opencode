---
feat-id: tests-mac-recent-feats
status: done
related: ./3-changelog.md
---

# 3-changelog — 为最近 3 个 feat 补 unit 测试(第 1 期 unit 起步)

## 起源

user 2026-05-07 决策"为最近从 GitHub 拉下来的改动规划全面测试"。这一笔实施 R5 测试纪律的 **unit 部分**,覆盖 Mac 端 22 commit 推下来的 3 个 feat:

- `md-export-pdf-word`(Word 导出 / 17 笔 commit)
- `menu-always-show-with-disabled`(右键 4 项始终显示)
- `md-context-menu-i18n`(右键菜单 i18n)

按测试金字塔(R5 决策 3:70/20/10),unit 优先。e2e 探路独立处理。

## 改动清单

### 新文件

- `packages/app/src/i18n/i18n-completeness.test.ts`(~110 行,7 测试)
  - 关键 namespace 守门:`fileViewer.*` / `common.*` 必须 100% 覆盖 zh / zht
  - 历史 namespace 漂移不在本测试范围(zh/zht 缺 ~20 个上游 key 是另一笔 backlog)
  - 最近 feat 11 个核心 key 显式断言(5 个 menu i18n + 4 个 export Word + 2 个 shortcutHint)
  - shortcutHint 模板含 `{{shortcut}}` 占位符校验

- `packages/app/src/utils/md-export-docx.test.ts`(~110 行,19 测试)
  - `mimeFromPath`:9 种扩展名 + 大小写无关 + Windows 反斜杠 + URL 风格 + 空字符串 + 仅扩展名
  - `friendlyError`:9 类常见错误中文化(EACCES / ENOSPC / EROFS / ENAMETOOLONG / EMFILE / ENOENT / nodebuffer / parse / 兜底)+ [详细] 段保留原文校验

### 修改

- `packages/app/src/utils/md-export-docx.ts`:
  - `mimeFromPath` 加 `export`(原 file-private)
  - `friendlyError` 加 `export`(原 file-private)
  - 各加 `// FORK: export for unit tests` 注释说明为什么 export

  这是为可测试性的最小修改,提升关键模块覆盖率(R5 决策 2 清单内文件),0 行为变化。

## 测试结果

| 测试套件 | pass / total |
|---|---|
| 新增 i18n-completeness | 7 / 7 ✓ |
| 新增 md-export-docx | 19 / 19 ✓ |
| **全套 packages/app unit** | **345 / 346**(1 fail = kobalte SSR 老坑,非新引入)|

测试增量:**320 → 346(+26 全 pass)**

## 揭露的真实问题(转 backlog)

i18n-completeness 测试**首次跑时**揭露了一个真实 bug:zh / zht 缺 en 上游加的 ~20 个 key(不在 fork 自家管的 `fileViewer.*` / `common.*` 范围内)。

漂移示例(部分):
- `command.project.previous` / `command.project.next`
- `session.child.promptDisabled`
- `sidebar.empty.title` / `.description`
- `settings.general.section.advanced`
- `settings.general.row.shell.*`
- `settings.general.row.showFileTree.*`

**处理决策**:这次范围聚焦"最近 feat",历史 i18n 漂移转 backlog,作为另一个 feat `i18n-history-drift-补全` 单独修。本测试套用"关键 namespace 守门"的范围限定,不阻塞工作流。

## 测试范围与边界

### 已覆盖(本次)

- ✓ unit:i18n key 完整性(关键 namespace)
- ✓ unit:md-export-docx 纯函数(mimeFromPath / friendlyError)

### 未覆盖(本次)→ 后续补

- ❌ unit:`splitRunsForEmoji` / `mergeCodeBlockParagraphs`(XML 字符串处理,需 fixture)
- ❌ unit:`base64ToBytes` / `bytesToBase64`(roundtrip 测试,简单)
- ❌ unit:`patchForeignObjects`(SVG 操作,需 SVG fixture)
- ❌ unit:`inlineLocalImages`(异步 + 文件系统依赖,需 mock)
- ❌ web e2e:**探路独立处理**(playwright 现有架子需要 dev server + opencode sidecar)
- ❌ 桌面 e2e:第 2 期(WebdriverIO + tauri-driver)

### 关键模块覆盖率推进

R5 决策 2 关键模块清单中,本次推进 1 个:

| 文件 | 测试覆盖前 | 测试覆盖后 |
|---|---|---|
| `markdown-editor-extensions.ts` | 0% | 0% |
| `dialog-settings.tsx` | 0% | 0% |
| `file-tabs.tsx` | 0% | 0% |
| **`md-export-docx.ts`** | **0%** | **~25%(2/8 helpers + 19 测试)** ⬆ |

后续 feat 继续推进其他文件覆盖率到 80% 门槛。

## 规模 / R 标记

- 规模:Medium(~220 行测试 + 2 行 export 注解 / 3 文件 / 0 R4 / 0 上游侵入)
- R2 FORK marker:✓(md-export-docx.ts 加 2 处 export 注解 + FORK 说明)
- R3 黑名单:无
- R4 override:无
- R5 测试纪律:**本 feat 就是测试本身,自动满足"含至少 1 个测试"要求**

## 下一步(待 user 决策)

- A. **继续:e2e 探路** — 试 Playwright dev server 启动 + 写一个最简单 smoke test(打开页面看 root 元素)。可能性:dev server 启不起来(需 opencode sidecar 跑 4096 端口),如果失败转 backlog
- B. **暂停:这一笔收尾,改天再做** — 26 测试落定,转 status=done,后续 feat 顺手补
- C. **修历史 i18n 漂移** — 把 zh / zht 缺的 ~20 个上游 key 补全(独立 feat)
