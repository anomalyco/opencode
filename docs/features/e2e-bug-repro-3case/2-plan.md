---
feat-id: e2e-bug-repro-3case
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# e2e-bug-repro-3case — 2-plan

> 实施轨迹 + 决策追加(开发中实时 append)

## 节奏

```
开 feat → 1-spec / 2-plan → A1(易) → A2(中) → A3(难) → 3-changelog → commit on feat → STOP 待 user 授权 merge/push
```

3 spec 按难度递增 — 先把 mock 框架的"基础 + 中等 + 高级"能力都摸一遍,A3 探索成本高所以放最后,如果 A3 撞硬墙可以单独降级到"驱动 store 直接验 reactive"。

## A1 — bug-repro-large-file-preview-guard

**步骤**:
1. `installServerMock` + `bootstrapMock` + `page.goto("/")`
2. 进 workspace(点 `/mock/workspace`)
3. `mockFileTree({ "huge.txt": "x" })`
4. `setMockFileSize(page, "huge.txt", 100 * 1024 * 1024)`
5. 点击文件树 `huge.txt` 节点
6. 验 viewer 渲染 `文件过大,跳过预览` 文字 + `用本机软件打开` / `打开所在文件夹` 2 按钮

**潜在坑**:文件树节点 click locator(从 mock-foundation 看是 `text="/mock/workspace"` 进 workspace,但具体文件行的 locator 没探过)→ 用 `page.locator('text="huge.txt"')` 试。

## A2 — bug-repro-chat-drop-overlay-stuck-fix

**步骤**:
1. bootstrap + 进 workspace
2. `mockFileTree({ "doc.md": "# Hi" })`
3. 验初始 prompt-input 没 `border-dashed` 类(基线)
4. 拿到 prompt-input 元素 → `page.dispatchEvent` 触发 `dragover`(带 `Files` types)→ 验 overlay **激活**(`border-dashed` 出现)
5. 关键:对文件树 row 元素 `dispatchEvent("drop")` 并模拟 `event.stopPropagation()` 杀掉 bubble
6. 验 window 级 capture-phase drop 触发 `setDraggingType(null)` → overlay **消失**

**潜在坑**:
- DataTransfer 在 chromium headless 环境的 Files types 注入 — 用 `Object.defineProperty` 或新 `DataTransfer()`(实测两种 Playwright 都支持)
- file-tree 行的 onDrop stopPropagation 行为已被代码 verify 过,本 spec 真验的是 window capture-phase 兜底逻辑

## A3 — bug-repro-auto-save-debounce-flush

**步骤**:
1. bootstrap + 进 workspace
2. `mockFileTree({ "note.md": "initial" })` + `preloadFile(page, "note.md", "initial")`
3. 点击 `note.md` 打开 viewer
4. **决策点**:
   - **路径 A(优先)**:点编辑按钮 → CodeMirror 打字 → 等 debounce
   - **路径 B(降级)**:直接 page.evaluate 调 `useFile().saveEdit` 触发 write_text_file → 验 memfs
5. 切到另一 tab 触发 flush(或等 debounce timer fire)
6. 验 memfs 拿到新内容
7. 验 toast 区域**没有**"AI 修改了此文件"(`markSelfWriting` 500ms 窗口生效证明)

**潜在坑**:
- 编辑模式入口 locator
- CodeMirror 在 mock 模式的输入模拟稳定性(Playwright `locator.fill` / `pressSequentially` 试)
- markSelfWriting 验证:监听 toaster 输出 / DOM 内 toast 元素 / 或验 write 完 1s 内 file.edited event 不再触发 toast 链路

## 决策追加

(开发中实时 append 踩坑 / 推翻 / 调整)

### 2026-05-23 — A1 实施踩坑(3 个 fixture infra bug 全暴露 + 顺手修)

A1 large-file-preview 实测连续 4 轮失败,逐层剥洋葱:

**bug 1 — file 路由时序**:`mockFileTree` 在 workspace click **之后**调用,文件列表 HTTP query 已先发拿了 catch-all `[]`,文件树渲染 "No files"。
修法:把 mockFileTree + setMockFileSize 移到 click **之前**。

**bug 2 — fixture mockFileTree shape 不对**:memfs.list 返 `{name, isDir, size, mtime}`,SDK FileNode 期望 `{name, path, absolute, type, ignored}`。mock-foundation smoke 没点过文件树没踩到,bug-repro 系列点文件触发后才暴露。
修法:`fixtures.ts` 加 shape 转换层。

**bug 3 — memfs.list("") 根目录 bug**:空 dir 时拼出 `prefix = "/"`,但 preload 文件路径无前导 `/`(如 `"small.txt"`),`p.startsWith("/")` 始终 false,**所有 root 文件被跳过**。memfs.read 工作正常掩盖了 list 问题。
修法:`memfs.ts` list 加空 dir 分支,prefix = `""`。

**bug 4 — Playwright glob 不匹配 query string**:pattern `**/file` 对 `/file?path=...` 不匹配(? 是 glob 单字符通配符),SDK 请求穿透 mockFileTree route 拿了 catch-all 空数组。
修法:`fixtures.ts` mockFileTree 改 RegExp `/\/file(\?|$)/` + 加 pathname guard 排除子路径。

每修一层都 re-run + 看 diagnostic(memfs/route/page snapshot)进一步定位。最终 A1 10.4s 过。

### 2026-05-23 — A2 实施 note

DnD 模拟用 `page.evaluate` + `dispatchEvent`:dragover (Files type) 激活 overlay → drop+stopPropagation 模拟 file-tree 行行为 → 验 window 级 capture-phase 兜底清 overlay。**首次跑过 7.1s**。

### 2026-05-23 — A3 实施 note

D1 决议降级路径生效 — 不戳 CodeMirror,走 `__deskfoxE2eInvoke("write_text_file")` 直驱(本质同 auto-save 落盘动作)。
验:① memfs 含新内容 ② mtime 自增 ③ DOM 无误 toast ④ mtime 冲突检测仍工作(回归保护)。
**首次跑过 7.4s**。

**markSelfWriting 反向用例**(无 mark 时 toast 该弹)不在 Phase 1 mock 范围,需要 SDK event listen 桥接 — 留 follow-up 或 Phase 2 真桌面。已在 spec 头注 + changelog 明说。


