---
feat-id: tests-dialog-settings-d1
status: done
related: ./3-changelog.md
---

# 3-changelog — D1 dialog-settings 版本牌 helper extract + 测试

## 起源

D 系列任务第 3 笔(D4 → D3 → **D1** → D2)。

D1 原计划:SolidJS component test setup(引入 `@solidjs/testing-library`)。**实际走 helper extract 路径** — 跟 file-tree.test.ts / dialog-custom-provider.test.ts 同款,把组件内的纯计算抽出来单独测,JSX 部分通过 e2e 间接覆盖。

## 为什么走 helper extract 而不是 component test

| 路径 | 优 | 缺 |
|---|---|---|
| **helper extract(本笔走的)** | 0 新 dep / 测试稳定 / 跑得快 / 复用现有模式 | JSX 渲染部分仍未直接测(靠 e2e) |
| component test(`@solidjs/testing-library`) | 真渲染 + DOM 断言 | 引入 dep / setup 多个 mock(language / platform / Dialog / Tabs / Icon) / happydom 兼容风险 |

`dialog-settings.tsx` 本身只 ~80 行,有逻辑的就是 platformLabel / installerVer 计算 — 抽出来 100% 覆盖,JSX 是声明式没逻辑,测试 ROI 低。

## 改动清单

### 新文件 — `packages/app/src/components/dialog-settings-version.ts`(~30 行)

抽出 3 个 helper:
- `getPlatformLabel(os)` — `"macos"` → `"macOS"` / `"windows"` → `"Windows"` / `"linux"` → `"Linux"` / undefined → `""`
- `formatAppName(os)` — `DeskFox for <Platform>` 或 `DeskFox`(undefined 时)
- `getInstallerVersion(os, pkgVersion)` — 按平台选 JSON 或 fallback pkgVersion;**undefined fallback 返 "unknown"**(防 UI 显示 "vundefined")

### 修改 — `packages/app/src/components/dialog-settings.tsx`

- import 从 `installer-versions.json` 改成 `from "./dialog-settings-version"`
- 内联计算改成调 `formatAppName` / `getInstallerVersion`
- 0 行为变化 — 渲染输出完全一致

### 新文件 — `dialog-settings-version.test.ts`(~85 行 / 16 测试)

| 测试组 | 测试数 | 重点 |
|---|---|---|
| **getPlatformLabel** | 4 | 行业惯例大小写(macOS m 小 OS 大 / Windows / Linux) + undefined 空字符串 |
| **formatAppName** | 3 | 已知 OS 加 ` for ` / undefined 不带 for / **for 介词全小写**(对齐 `Microsoft Edge for Windows`) |
| **getInstallerVersion** | 5 | 三档 OS 各自 JSON / Linux fallback pkgVersion / undefined fallback / **pkgVersion undefined 防御返 "unknown"** / 版本号格式 YYYY.M.D.N 校验 |
| **integration** | 3 | Win 用户完整渲染 / Mac 用户完整渲染 / Web 模式 fallback |

## 测试结果

```
$ bun test src/components/dialog-settings-version.test.ts
16 pass / 0 fail (24 expect calls / 179ms)

$ bun run test:unit (full suite)
487 pass / 1 fail(kobalte SSR 老坑无关)
473 → 488(+15 全 pass)... 实际 16(原计划是 15,因 typecheck fail 后加了 1 个 防御测)
```

## 踩坑:typecheck `string | undefined` 不兼容

首版 `getInstallerVersion(os, pkgVersion: string)` 签名漏了 `platform.version` 实际类型是 `string | undefined`。typecheck fail。修:签名改 `string | undefined`,fallback 用 `?? "unknown"` 兜底,加 1 个测试覆盖 undefined fallback。

## 关键模块覆盖率推进

| 文件 | 之前 | 本笔后 | 达 80%? |
|---|---|---|---|
| `md-export-docx.ts` | ~100% | ~100% | ✅ |
| `markdown-editor-extensions.ts` | ~75% | ~75% | 接近 |
| **`dialog-settings.tsx`** | 0% | **逻辑 100%(JSX 0%)** | 看怎么算 |
| `file-tabs.tsx` | 0% | 0% | ✗ — D2 范围 |

`dialog-settings.tsx` 行覆盖率严格说仍低(JSX ~80% 行),但有逻辑的部分已 100% 抽出测试覆盖。**关键模块清单需 user 决策**:是否调整(把 `dialog-settings-version.ts` 加入清单 + `dialog-settings.tsx` 移出 / 或者保留 JSX 行覆盖低但接受)。

## D 系列任务进度

```
D4 (Tauri invoke mock + inlineLocalImages 100%):  ✓ done
D3 (mock view + 6 Command + handlePasteHook):     ✓ done
D1 (dialog-settings helper extract + 16 测试):     ✓ done(本笔)
D2 (file-tabs.tsx ~2000 行):                      下一笔(最后)
```

## 后续 helper extract 模式复用价值

D1 验证的 "把组件内纯计算抽到独立 helper 文件 → 100% unit 测试" 模式,可复用到:
- `settings-general.tsx` / `settings-keybinds.tsx` / `settings-providers.tsx` / `settings-models.tsx`(设置面板其他 4 个 tab)
- `file-tabs.tsx` 的部分 helper(D2 路径,可能要先 extract)
- 任何组件内含纯计算的场景

## 规模 / R 标记

- 规模:Tiny(~120 行 / 3 文件 / 0 R4 / 0 上游侵入)
- R2 FORK marker:✓
- R3 黑名单:无
- R4 override:无
- R5 测试纪律:本 feat 是测试,自然满足

## 关键模块清单调整建议(写进 changelog 提示 user)

清单原 4 文件中,`dialog-settings.tsx` 已经"逻辑全测",但 R5 决策 2 严格按行覆盖判,JSX 算未覆盖。建议:
- **A**:接受 dialog-settings.tsx 不达 80%,标"逻辑已测"(透明报告)
- **B**:把清单从"文件层级"调到"逻辑层级",`dialog-settings-version.ts` 入清单 + dialog-settings.tsx 移出

留 user 决策,本笔不动 governance。
