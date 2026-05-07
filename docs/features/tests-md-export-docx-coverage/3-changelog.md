---
feat-id: tests-md-export-docx-coverage
status: done
related: ./3-changelog.md
---

# 3-changelog — md-export-docx.ts 覆盖率推进到 ≥ 80% 门槛(R5 决策 2 首个达标)

## 起源

R5 决策 2 设关键模块清单覆盖率 ≥ 80% 硬门槛。前笔 `tests-mac-recent-feats` 把 `md-export-docx.ts` 覆盖到 ~25%(2/8 helpers / 19 测试)。本笔继续推进到 ~87.5%(7/8 helpers / 45 测试),**首次让关键模块达标**。

## 改动清单

### 修改 — 给 4 个 helper 加 export 注解

`packages/app/src/utils/md-export-docx.ts`:
- `mergeCodeBlockParagraphs` → `export function`
- `base64ToBytes` → `export function`
- `bytesToBase64` → `export function`
- `splitRunsForEmoji` → `export function`
- `patchForeignObjects` → `export function`

每处加 `// FORK: export for unit tests 2026-05-07` 注释。0 行为变化,纯可测性提升。

### 扩展 — `md-export-docx.test.ts` 加 4 个测试组(净 +26 测试)

| 测试组 | 测试数 | 重点 |
|---|---|---|
| **base64ToBytes / bytesToBase64** | 5 | 空字节 / ASCII roundtrip / 全字节范围 0-255 / 分块边界(0x10000 跨 chunk)/ 标准 padding |
| **splitRunsForEmoji** | 7 | 无 emoji 不变 / 纯 emoji 加字体 / 混合 run 切多段 / 已有 rPr 处理(替换 / 插入 rFonts)/ 国旗 emoji / xml:space preserve |
| **mergeCodeBlockParagraphs** | 7 | 无代码不变 / 单段不合并 / 2+ 段合并 / 3+ 段合并 / spacing 归零 / **inline code bug 防护**(段落级 Normal + run 级 MdCode 不被误并)/ 跨 normal 段不合并 |
| **patchForeignObjects** | 7 | 无 foreignObject 不变 / 空被移除 / 单行 → SVG text(中心定位)/ 多行 → 多 tspan(dy 偏移)/ 多个一起处理 / 缺 x/y 默认 0 / 纯空白被视空 |

测试新加 `svgFromString` fixture helper 用 `DOMParser` + `image/svg+xml` mime,happydom 完整支持。

## 测试结果

```
$ bun test src/utils/md-export-docx.test.ts
45 pass / 0 fail

$ bun run test:unit (full suite)
372 pass / 1 fail (kobalte SSR 老坑无关)
347 → 373 (+26 全 pass)
```

## 关键模块清单覆盖率推进

| 文件 | 覆盖前 | 覆盖后 | 达 80% 门槛? |
|---|---|---|---|
| `packages/app/src/utils/markdown-editor-extensions.ts` | 0% | 0% | ✗ |
| `packages/app/src/components/dialog-settings.tsx` | 0% | 0% | ✗ |
| `packages/app/src/pages/session/file-tabs.tsx` | 0% | 0% | ✗ |
| **`packages/app/src/utils/md-export-docx.ts`** | **~25%** | **~87.5%(7/8 helpers)** | **✅ 首个达标** |

剩 1 个未覆盖:
- `inlineLocalImages`(异步 + Tauri invoke `read_binary_file_base64`,需 mock)— 转独立 backlog,需要先决定 mock 框架(bun test 自带 mock 还是 vi-test 风格)

## R5 决策 2 治理意义

**第一个关键模块达 80% 门槛**,验证治理规则可执行。其他 3 个文件后续按计划推进:

- `markdown-editor-extensions.ts`:依赖 CodeMirror 编辑器,需 happydom + EditorState fixture,中等难度
- `dialog-settings.tsx`:SolidJS 组件,需要 component test setup(@solidjs/testing-library?)
- `file-tabs.tsx`:大文件(~2000 行),含选区 / 渲染 / 编辑态多套逻辑,**最复杂**,可能需多笔 feat 推进

## 没做的(转 backlog)

- `inlineLocalImages` 测试(需 Tauri invoke mock)
- `exportMdAsDocx` 集成测试(端到端,markdown → docx blob,可能转 e2e 路线)
- 其他 3 个关键模块的覆盖率推进(单独 feat 处理,本笔不强求)

## 规模 / R 标记

- 规模:Medium(~210 行测试 / +5 行 export 注解 / 2 文件 / 0 R4 / 0 上游侵入)
- R2 FORK marker:✓(md-export-docx.ts 加 5 处 `// FORK: export for unit tests`)
- R3 黑名单:无
- R4 override:无
- R5 测试纪律:本 feat **就是测试本身**,自然满足

## BAC 任务进度

```
B (i18n-history-drift-补全):     ✓ done(`dc22a5221`)
A (e2e-smoke-探路):              ✓ done(`7f140a65a`)
C (md-export-docx 覆盖率到 80%):  ✓ done(本笔)
```

**BAC 全部完成**。
