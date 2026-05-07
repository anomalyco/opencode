---
feat-id: e2e-smoke-探路
status: done
related: ./3-changelog.md
---

# 3-changelog — e2e Playwright 架子探路 + smoke baseline 建立

## 起源

`tests-mac-recent-feats` feat 收尾时,我把 e2e 列为可选 A 选项("探路 web e2e Playwright setup")。user 选 BAC 顺序后,本笔实施 A:确认 Playwright 现有架子是否能跑通。

## 探路结论

**Playwright + vite dev server 链路可用**,但 **web 版业务测试需先解决 opencode server 集成问题**。

## 改动清单

### 新文件

- `packages/app/e2e/smoke.spec.ts`(~30 行)
  - **baseline 测试**:只 assert "链路通"(HTTP 响应 + HTML 文档 + URL 正确)
  - **故意不测业务逻辑** — 因为无 opencode sidecar 时前端 body 为空

- `packages/app/e2e/README.md`(~70 行)
  - e2e 现状 / 跑法 / 测不了什么 / 后续接入路径(3 选 1)
  - 命名规范("不动上游 todo.spec.ts")
  - 测试金字塔比例提醒(对齐 R5 决策 3)

## 探路过程踩的坑

### 坑 1:Playwright chromium 二进制没装

首次跑报错 `Executable doesn't exist at ...chrome-headless-shell-win64\chrome-headless-shell.exe`。修:`bunx playwright install chromium`,下载 ~111MB。

### 坑 2:web 版需要 opencode server,无 sidecar 时 body 为空

```
[smoke] body text length: 0
expect(0).toBeGreaterThan(0)  ← fail
```

根因:DeskFox 前端启动后立刻 fetch `127.0.0.1:4096`(opencode server),无后端时初始化卡住,body 不渲染。修:把 baseline 测试**降级**为只测链路通,不测 UI 内容。

## 测试结果

```
$ bun run test:e2e smoke.spec.ts
1 passed (10.2s)
```

启动时序:
- vite dev server 启动:~5s
- chromium headless 加载:~3s
- 测试断言:<1s

## 后续接入路径(独立 backlog)

要让 e2e 能测真实业务逻辑,需先做下面任一:

| 方案 | 何时做 |
|---|---|
| **A. webServer 同时启 opencode server** | 长期方案,配置复杂 |
| **B. 前端加 e2e mock mode**(`VITE_E2E_MOCK=1`)| **推荐先做** — 维护 mock 数据,跑得快 |
| **C. server fixture replay** | 后期视情况 |

详见 `packages/app/e2e/README.md` 的"后续接入路径"段。

## 没动上游

- `e2e/todo.spec.ts`:上游占位 fixme,**保留不动**(避免 sync 冲突)
- `playwright.config.ts`:上游配置,**保留不动**
- 新加文件 `smoke.spec.ts` / `README.md` 走 fork-only 路径

## 规模 / R 标记

- 规模:Tiny(~100 行 / 2 新文件 / 0 R4 / 0 上游侵入)
- R2 FORK marker:smoke.spec.ts 顶部有 `// FORK:` 注释说明
- R3 黑名单:无
- R4 override:无
- R5 测试纪律:本 feat 是测试本身,自然满足

## 状态汇总(B + A 完成后)

```
B (i18n-history-drift-补全):     ✓ done
A (e2e-smoke-探路):              ✓ done(本笔)
C (md-export-docx 测试扩到 80%):  ⏳ 下一步
```

## 下一步:C(给 `md-export-docx.ts` 补测试到 ≥ 80% 覆盖率)

按 R5 决策 2,关键模块 `md-export-docx.ts` 需达 80%。当前 ~25%(2/8 helpers + 19 测试)。剩待覆盖:
- `splitRunsForEmoji`(emoji 切 run)
- `mergeCodeBlockParagraphs`(代码块 single-paragraph 合并)
- `base64ToBytes` / `bytesToBase64`(base64 编解码)
- `patchForeignObjects`(SVG foreignObject patch)
- 部分 `inlineLocalImages`(异步,可 mock)

预计再写 30-50 个测试达 80% 门槛。
