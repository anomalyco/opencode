---
feat-id: e2e-bug-repro-3case
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# e2e-bug-repro-3case — 3-changelog

> **Phase 1 e2e 首批 bug-repro 示范用例** — 3 个 spec 落地 + 路上修了 Phase 1 fixture infra 4 个 bug

## 一句话

落地 A6 large-file-preview / A5 chat-drop-overlay / A4 auto-save 三个 bug-repro spec(各 ~80 行),实施中暴露 Phase 1 fixture infra 4 个 bug(timing / shape / memfs.list root / Playwright glob query)全数顺手修。全套 e2e 11 passed / 1 skipped / 14s。

## 实际投入

- A1 spec/plan(立项):0.3h
- A6 large-file 实施 + 调试 4 轮(暴露 4 个 fixture bug + 全修):2.5h
- A5 chat-drop:0.5h(首跑过)
- A4 auto-save:0.4h(首跑过,走 D1 降级路径)
- 3-changelog + INDEX + commit:0.3h

**合计:~4h**(原估 ~5h,持平偏低 — fixture bug 是意外但相对集中)

## commit hash 列表

| commit | 阶段 | 内容 |
|---|---|---|
| (本笔) | feat 收尾 | 3 spec + fixture/memfs 4 bug 修 + 三文档 + INDEX |

## 文件清单

### 新文件(本 feat 自家代码)

| 文件 | 行数 | 角色 |
|---|---|---|
| `packages/app/e2e/bug-repro-large-file-preview-guard.spec.ts` | 67 | A6 spec |
| `packages/app/e2e/bug-repro-chat-drop-overlay-stuck-fix.spec.ts` | 83 | A5 spec |
| `packages/app/e2e/bug-repro-auto-save-debounce-flush.spec.ts` | 116 | A4 spec(D1 降级路径)|
| `docs/features/e2e-bug-repro-3case/{1-spec,2-plan,3-changelog}.md` | ~340 | 三文档 |

### 修改文件(Phase 1 fixture infra 4 bug 修)

| 文件 | 改动 | 修哪个 bug |
|---|---|---|
| `packages/app/e2e/fixtures.ts` | +20 / -8 | bug 2 shape 转换 + bug 4 RegExp pattern 替 glob |
| `packages/app/e2e/mocks/memfs.ts` | +3 / -1 | bug 3 root listing prefix 空字符串 |
| `docs/features/INDEX.md` | +1 | feat 入口 |

**总:~640 行(代码 + 文档)**,Medium 规模偏小。

## Fixture / memfs 4 bug 修详情

### bug 1(spec 内修)— mock 注册时序
症状:`mockFileTree` 在 workspace click 之后调用,文件列表 HTTP query 已先发拿了 catch-all `[]`,文件树渲染 "No files"。
修法:每个 bug-repro spec 都把 mockFileTree + setMockFileSize 移到 click **之前**。
**影响**:未来所有需要文件树渲染的 spec 必须遵守"mock 早于 click"约定。

### bug 2(fixture 修)— mockFileTree shape 不对
症状:memfs.list 返 `{name, isDir, size, mtime}`,SDK FileNode 期望 `{name, path, absolute, type, ignored}`。mock-foundation smoke 没点过文件树没踩到。
修法:`fixtures.ts` mockFileTree 路由 handler 加 shape 转换层,把 memfs items 转 FileNode。
**影响**:Phase 1 mock 现在支持真 SDK file.list 路径,文件树 UI 可正常 render mocked files。

### bug 3(memfs 修)— list("") root listing
症状:空 dir 时拼出 `prefix = "/"`,但 preload 文件路径无前导 `/`(如 `"small.txt"`),`p.startsWith("/")` 始终 false,**所有 root 文件被跳过**。memfs.read 工作正常掩盖了 list 问题。
修法:`memfs.ts` list 加空 dir 分支,prefix = `""`。
**影响**:root 目录 listing 现在工作,所有依赖根目录文件枚举的 spec 受益。

### bug 4(fixture 修)— Playwright glob 不匹配 query string
症状:pattern `**/file` 对 `/file?path=...` 不匹配(? 是 glob 单字符通配符,URL 含 `?` 后 glob 失配),SDK 请求穿透 mockFileTree route 拿了 catch-all 空数组。
修法:`fixtures.ts` mockFileTree 改 RegExp `/\/file(\?|$)/` + 加 pathname guard 排除 `/file/content` 等子路径。
**影响**:带 query string 的 SDK endpoint 现在能被 mock 拦截。未来 fixture 新增 endpoint mock 应优先 RegExp(若 endpoint 带 query)。

## 影响范围

### 生产 build:0 影响
- 所有改动在 `packages/app/e2e/` 目录内,生产 build 不会包含
- fixture / memfs 修的都是 mock 路径行为,不接触 `packages/app/src/`

### 现有 e2e 套件:全过(0 回归)
- 8 原 spec(Stage ② mock + mock-foundation smoke 等)+ 3 新 spec = 11 passed / 1 skipped / 14s
- 全套耗时从 10.5s 增到 14s(+33%),3 个新 spec 各 ~7-10s 在预期范围

### 治理(R5 v4 落地首笔)
- R5 v4 立法时这 3 个 bug-repro 示范用例是"必须落地"的承诺(`e2e-phase1-mock-mode` follow-up backlog 第 2 项),本 feat 兑现
- View 清单硬门槛即时生效后,file-tabs.tsx 触动时一并补 e2e 的承诺,A4 已部分覆盖 file-tabs 写流程

## 回归测试

| 测试 | 结果 |
|---|---|
| typecheck | ✅ 16/16(14 cached + 2 重新走 525ms)|
| e2e 全套 | ✅ 11 passed / 1 skipped / 14.0s |
| A6 large-file-preview-guard | ✅ 10.4s,FileTooLarge 卡 + 2 按钮渲染验通 |
| A5 chat-drop-overlay-stuck-fix | ✅ 7.1s,baseline 0 → dragover 1 → drop+stopPropagation 0 |
| A4 auto-save-debounce-flush(D1 降级)| ✅ 7.4s,memfs 同步 + mtime 自增 + 0 误 toast + mtime 冲突保护 |

## 回退方法

如需回退本 feat:
1. `git revert <commit-hash>` 撤掉本笔
2. 3 个 bug-repro spec 文件删除
3. fixture / memfs 4 个 bug 修同步回退(memfs.list root listing bug 会重新存在 — **不建议** 单回 fixture/memfs 修而保留 spec,会破其它 spec)

或者只回退 spec 文件保留 fixture/memfs 修(它们独立有价值):
1. `git rm packages/app/e2e/bug-repro-*.spec.ts`
2. `git commit -m "revert(e2e-bug-repro): drop 3 bug-repro spec,保留 fixture/memfs infra 修"`

## Follow-up backlog(不阻塞本 feat done)

| 项 | 内容 | 时长 |
|---|---|---|
| **A4 完整版 — CodeMirror 真打字 + 1s debounce + tab switch flush** | 验完整 user flow(本笔走 D1 降级)| 2-3d |
| **markSelfWriting 反向用例** | 无 mark 时 dirtyConflict toast 该弹 — 需 SDK event listen 桥接到 mock SSE | 1-2d |
| **CI pre-push hook gate** | git push 前自动跑 Phase 1 e2e(继承自 `e2e-phase1-mock-mode` follow-up)| 1d |
| **View 清单硬门槛补债** | `dialog-settings.tsx` + `file-tabs.tsx` 各加 ≥ 1 e2e | 各 0.5-1d |

## 规模 / R 标记

- **规模**:Medium(~640 行,代码 ~266 行 spec + ~24 行 fixture/memfs 修 + ~350 行文档)
- **R1 三级跳**:新文件优先 ✅(spec 全在 `packages/app/e2e/`,fixture/memfs 修小)
- **R2 FORK marker**:测试 / fixture 文件已带 `[feat: e2e-bug-repro-3case]` tag,memfs 修加 FORK 注释
- **R3 配置 override**:0 用
- **R4 黑名单 override**:0 笔
- **R5 v4 履约**:本 feat 本身就是 R5 v4 bug-repro 提级到 Phase 1 e2e 的首批示范
- **R6 / R7**:N/A(本 feat 0 网络监听 / 0 bug fix on 产品代码,本 feat 自己就是 bug-repro)

## 时间戳

- 立项 + 实施 + 收尾:2026-05-23 单日
