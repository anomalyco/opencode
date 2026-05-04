---
feat-id: file-tree-ux-polish
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# file-tree-ux-polish — Changelog

> 实施日期:2026-05-04
> Medium 规模,~260 行代码 + ~440 行文档,跨 7 个 fork-only 文件,**0 上游侵入**。
> 文件树 UX 一揽子优化:自动刷新 + 右键菜单重整(2 套)+ 默认状态 + 键盘导航 + 修复刷新递归。

---

## 触发原因

`feat/file-tree-dnd`(2026-04-27 ~ 04-29)落地 mini-Finder 级文件树后,日常使用浮现 5 个 UX 缺口:

1. LLM 整理完文件**不自动刷新** — 每次手动右键才看到改动
2. 节点右键菜单**分组混乱** + 无意义"打印"项 + 缺"复制路径" + 缺"刷新"
3. 空白处右键菜单刷新**只刷根**,不刷已展开的子目录(用户感知"刷了等于没刷")
4. 新项目打开默认**面板收起 + tab 在"0 更改"**,与"全文件视图为主"工作流不符
5. 树**键盘导航全缺**(↑↓/Enter/F2/Delete 都没绑)

---

## commit 列表(post-rebase 哈希)

> Rebase 自因:实施期间(2026-05-04 上午)远端 dev 合入了 `filetree-ctrlc-textsel-fix`(Ctrl+C 失效修),也动了 `use-file-tree-shortcuts.ts`。本笔合 dev 前 rebase 一次,**自动 merge 通过、无冲突**(双方动了 shouldTrigger / 注释块的不同行段),典型范例:小颗粒 commit + FORK marker 让分散修改自然共存。

| # | commit | 主题 |
|---|---|---|
| 0a | `b07ec7ca1` | docs(file-tree-ux-polish): 1-spec 锁版 — 5 项 UX 优化需求 + 6 开放点决议 |
| 0b | `be42979a1` | docs(file-tree-ux-polish): 2-plan — 5 笔 commit 拆分 + 排序 + 16 测试用例 |
| 1 | `65b4244cf` | feat(file-tree): 新用户默认展开右侧面板 + tab 默认所有文件 |
| 2 | `0173dcc3f` | feat(file-tree): 节点右键菜单重整 — 4 组重排 + 加复制路径/刷新 + 删打印 |
| 3 | `34afbd99d` | feat(file-tree): 空白处右键菜单重整 + 修复刷新递归(扫所有 expanded 子目录) |
| 4 | `696231093` | feat(file-tree): 键盘导航 ↑↓/Enter/F2/Delete + macOS Backspace |
| 5 | `21e26335b` | feat(file-tree): LLM 响应结束(busy→idle)自动刷新文件树 |
| (合 dev)| (待补 merge commit hash)| Merge feat/file-tree-ux-polish into dev |

实施顺序与 plan 一致(#4 → #2 → #3 → #5 → #1),依赖链:#3 加 `refreshAllExpanded` → #1 复用 / #5 复用 #2 加的 promptRename promptDelete。

---

## 改动详情

### commit 1 — 默认展开 + tab "all"

**文件**:`packages/app/src/context/settings.tsx` / `packages/app/src/context/layout.tsx`

- `settings.tsx:111` — `showFileTree: false → true`
- `layout.tsx:248` — 初始 `opened: false → true`,`tab: "changes" → "all"`
- `layout.tsx:623` — fallback `?? "changes" → ?? "all"`
- `layout.tsx:635/642/649/656` — 4 处 `open()` / `close()` / `toggle()` / `resize()` 内部 fallback 同步改 "all"
- **保留 line 171 老用户 migration 路径** `tab: "changes"` 不动(决议 D 不迁老用户 — 让从老版本升级、`fileTree.tab` 字段未存的用户保留旧默认)

**5 行核心 + 4 行 fallback = 12 行**(不含 FORK 注释)。

### commit 2 — 节点右键菜单重整

**文件**:`packages/app/src/components/file-tree.tsx`

- 删 `<ContextMenu.Item ... onSelect={() => window.print()}>` "打印"项
- 加 `copyPathToClipboard(target)` helper:多选(`selection.paths().length > 1`)→ 全部 path 用 `\n` 拼;单选 / 无 selection → `target.absolute`;`navigator.clipboard.writeText(...)` + 成功 / 失败 toast
- 加 `refreshNode(target)` helper:文件夹刷自身,文件刷 `dirname(path)`
- 改 `promptNewFileAt` placeholder:`"文件名(默认 .md)" → "文件名"`;`defaultValue` 保留 `untitled.md`(决议 B,默认 markdown 行为不变)
- 重排 `renderRowMenuItems` 4 组:
  - 组 1:重命名 / 复制 / 剪切 / [粘贴 if clipboard 非空] / 删除
  - 组 2:在文件夹中显示 / 复制文件路径(新)
  - 组 3:新建文件 / 新建文件夹(文案去 "(.md)")
  - 组 4:刷新(新)

**~50 行**(含 helpers + JSX 重排)。

### commit 3 — 空白菜单 + 修复刷新递归

**文件**:`packages/app/src/context/file/tree-store.ts` / `packages/app/src/context/file.tsx` / `packages/app/src/components/file-tree.tsx`

**根因**:`file.tree.refresh(path)` 只 `force re-list` 单目录。用户在已展开的子目录(如 `src/utils/`)外部加文件后,右键空白处刷新 → 只刷根 → 看不到 `src/utils/` 的新文件。

**修法**:
- `tree-store.ts` 加 `refreshAllExpanded(rootInput)`:`Promise.all([listDir(root, force), ...所有 expanded:true 子目录的 listDir(path, force)])`
- `context/file.tsx` line 312 透出为 `file.tree.refreshAll(input)`
- `file-tree.tsx` 空白菜单 2 组重排,刷新调用从 `file.tree.refresh(rootRel)` → `file.tree.refreshAll(rootRel)`

**~25 行**。

### commit 4 — 键盘导航

**文件**:`packages/app/src/hooks/use-file-tree-shortcuts.ts` / `packages/app/src/components/file-tree.tsx`

**hook 端**(`use-file-tree-shortcuts.ts`):
- `ShortcutHandlers` 加 5 个可选:`onArrowUp` / `onArrowDown` / `onEnter` / `onRename` / `onDelete`
- `onKeyDown` 增加 "无任何 modifier 时" 分支,匹配 `ArrowUp` / `ArrowDown` / `Enter` / `F2` / `Delete` / `Backspace`(macOS 习惯,决议 E)
- 复用现有 `shouldTrigger` 决策(rebase 后还附加远端 `hasTextSelectionOutsideFileTree` gate,导航键自动受益)

**组件端**(`file-tree.tsx`):
- 加 `buildFlatVisible(rootPath)` 递归扫 `file.tree.children` + `dirState.expanded`,得到当前可见节点扁平序列(尊重 expand 状态,与 nodes() memo 的 filter 解耦)
- `navigateRelative(delta)`:从 selection 末尾节点的 idx 算 `idx + delta`,有则 `selection.replace(next.absolute)`,空 selection → 选第一个
- `singleSelectedNode()`:辅助,只在单选时返回 FileNode
- `onEnterAction`:文件 → `props.onFileClick`;文件夹 → toggle expand
- `onRenameAction`:单选 → `promptRename(node)`(已有)
- `onDeleteAction`:selection 非空 → `promptDelete(firstNode)`(`promptDelete` 内部 `sourcesFor` 读 selection 处理批量)

**~120 行**。

### commit 5 — LLM 响应结束自动刷新

**文件**:`packages/app/src/pages/session/session-side-panel.tsx`

- 加 `useParams` import + `on` import 扩展
- `createEffect(on(() => sync.data.session_status[params.id ?? ""]?.type, (next, prev) => {...}, { defer: true }))` 监听
- 边沿条件:`next === "idle" && prev !== undefined && prev !== "idle"`(典型 busy→idle)
- 触发:`void file.tree.refreshAll("")`(根递归)
- 模式与 `session.tsx:991` 现有 `refreshVcs` effect 一致;放在 SessionSidePanel 内意味着只有面板组件 mount 时才挂(panel 收起时 DOM 仍 mount,所以实际 = 始终监听,但开销低)

**~17 行**。

---

## 影响范围

| 文件 | 改动行 | 性质 |
|---|---|---|
| `packages/app/src/components/file-tree.tsx` | +156 / -27 | fork-only(file-tree-dnd 自加)|
| `packages/app/src/hooks/use-file-tree-shortcuts.ts` | +52 / -1 | fork-only(file-tree-dnd 自加,filetree-ctrlc-textsel-fix 改) |
| `packages/app/src/context/settings.tsx` | +1 / -1 | fork-only(单字段改默认值)|
| `packages/app/src/context/layout.tsx` | +14 / -4 | fork-only(单字段改默认值 + 4 处 fallback)|
| `packages/app/src/context/file.tsx` | +2 | fork-only(透出 refreshAll)|
| `packages/app/src/context/file/tree-store.ts` | +14 | fork-only |
| `packages/app/src/pages/session/session-side-panel.tsx` | +18 / -1 | fork-only |

**0 上游侵入**(所有文件都是 fork-only / fork 自加)。docs 三文档共 ~640 行(spec 232 + plan 206 + 本 changelog ~200)。

**上游侵入率**:不变。

---

## 验证

| 测试项 | 操作 | 结果 |
|---|---|---|
| typecheck | `bun run --cwd packages/app typecheck` | ✅ tsgo -b exit 0(每笔 commit 后都跑过)|
| 单元测试 | `bun test --preload ./happydom.ts ./src` | ✅ 319/320 pass(1 fail 是 dev 上预存的 kobalte SSR 兼容问题,**与本笔无关** — 已在 dev 切回原状态确认同测试 fail)|
| release build | `bash packages/branding/scripts/build-deskfox.sh -Env dev` | ✅ raw binary + .app + .dmg 全出炉(`DeskFox Dev_1.14.33_aarch64.dmg` 52 MB)|
| user 手动 UI 测试 | 16 条用例(见 2-plan §"测试用例")| ✅ user 反馈"测试没问题" |
| rebase 冲突 | `git rebase origin/dev`(远端 ctrlc-textsel-fix 入 dev 后)| ✅ 自动 merge 通过 0 冲突 |

---

## 回退方法

每笔独立 commit,可单独 revert:
```bash
git revert <commit-hash>
```

整笔回退:revert 合 dev 时的 merge commit。

各 commit 单独 revert 不会破坏功能完整性(每笔自包含 — 例:revert #5 自动刷新只是回到"手动刷新"状态;revert #4 键盘导航只是回到"鼠标-only"状态),除非 #3(它加了 refreshAll,#1 和 #5 内部都用)。如要 revert #3,需先 revert #1 和 #5 或同时 revert。

---

## 重大经验

1. **小颗粒 commit + FORK marker 让 rebase 几乎免冲突**:实施过程中远端 dev 合入了**正好动同一文件**(`use-file-tree-shortcuts.ts`)的修复(`filetree-ctrlc-textsel-fix`),按常理至少注释块要冲突。但因双方都用 FORK-BEGIN/END + 各自加在不同位置(他们改 `shouldTrigger` 函数体 + 顶部注释行;我改 `ShortcutHandlers` 类型 + `onKeyDown` switch + 顶部注释独立行),git 三方 merge 算法自动合并通过。**结论:多人/多分支同时改 fork-only 文件时,小颗粒 + 标 marker 是最高 ROI 的"防冲突"工程实践**,不需要 hard 锁文件 / 等同事 merge / 规划 hand-off,自动化合并兜底足矣。

2. **回归测试:typecheck ≠ 测试,build 通过 ≠ 测试**:user 询问"跑过回归测试吗"暴露我盲点 — 5 笔 commit 期间只跑了 typecheck + build。补跑 unit 测试发现 320 用例 1 fail(后定位是 dev 上预存)。**结论:Medium+ 改动收尾前必跑一次完整 `bun test`,即使 typecheck 全过 + build 编译通过 — 那是两个不同维度的证据**。沉淀到下次 SOP:plan 阶段加一行"实施后跑 `bun test --preload ./happydom.ts ./src` 全套",作为 changelog 验证表必填项。

3. **"刷新但 UI 没刷"的本质**:`tree-store.ts:50` 已有 FORK 注释提示 force=true 必须绕 inflight(2026-04-28 file-tree-dnd 加),但**那只解决"force 单目录"的等待错值**;真正的"用户感知没刷"还有第二维度 — **递归覆盖率不够**。本笔加 `refreshAllExpanded` 是补这一维。**结论:"刷新"语义至少有两个轴 — ① 该目录数据是不是新的(被 force 解决) ② 哪些目录被刷了(本笔 refreshAllExpanded 解决)**。tree-store 设计上以"被请求时按需 list"为主,refreshAll 是新增的"强制递归扫已展开"操作,语义上独立于 refresh。

4. **决议 D "不迁老用户" 的实际效果**:user 提了个好问题"老用户到底什么影响",细究后发现:有 fileTree 字段但 tab 未存的用户走 line 171 migration 拿到 "changes",新装用户走 line 248 拿到 "all";两者都尊重各自的"未明确表态"边界。**结论:改 default 时,要明确"已存值 vs 未存值 vs 已 migration 过"三态,各自的预期路径**。仅改 default 常量是"对未持久化的新用户生效",对老用户多半无感。如果要全员看到新行为,得做 migration 笔(但本笔决议不做,接受老用户感知不到 — 用户基数小,代价合理)。

---

## Follow-up backlog(不在本笔)

- 树内搜索 / 过滤(独立 feat,后续)
- git 状态徽章(独立 feat,后续)
- hidden file 切换(独立 feat,后续)
- 拖到外部应用(Tauri webview 限制,独立技术评估)
- Reveal in Tree(从编辑器反向定位)— 可考虑下一笔
- ↑↓ 跨折叠节点自动展开父(决议 F 不做,简单版先用)
- 已有用户 localStorage migration 强迁(决议 D 不做,等用户基数到一定量再考虑)
