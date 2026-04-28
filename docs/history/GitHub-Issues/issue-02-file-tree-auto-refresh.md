# Issue #02 — 文件树在外部新建文件后不自动刷新（含双路径：评论 #23616 为主 / 独立 issue 兜底）

**目标仓库**: https://github.com/sst/opencode
**状态**: 待提交
**语言**: 中文
**首选路径**: 在 **[#23616](https://github.com/sst/opencode/issues/23616)** 下评论（该 issue 2 天前由他人提出、已分配 @adamdotdevin、与本诉求高度重合）
**备选路径**: 若 #23616 被关闭 / 维护者引导另开 / 核对后确认场景不同 → 按下方独立 issue 版本发
**前置必做**: 提交前用 `gh issue view 23616 --repo sst/opencode` 拉取最新原文，确认本文档的复现/方案与其**非重复**，否则精简

---

## 共用事实基础（两个版本都用）

### 调研结论（来自仓库源码扫描）

1. **sidecar 已发事件**：sidecar 通过 SSE 向前端发 `file.watcher.updated` 事件，payload 形如 `{ file, event: "change" | "add" | "unlink" }`。
2. **前端已处理但有漏洞**：`packages/app/src/context/file/watcher.ts` 的 `invalidateFromWatcher` 对 `add` / `unlink` 事件有判断：
   ```ts
   if (!ops.isDirLoaded(parent)) return
   ops.refreshDir(parent)
   ```
   **语义问题**：如果新建文件的父目录**尚未被用户展开过**，事件被直接丢弃。后续用户展开该目录时，`tree-store` 从缓存读取旧列表，**永远看不到新文件**，除非整个应用刷新。
3. **Rust/Tauri 端没有 FS watcher**（`notify` crate 等均未在 `packages/desktop/src-tauri/Cargo.toml` 中），**不需要引入新依赖**。
4. **相关 issue 串**：
   - [#23616](https://github.com/sst/opencode/issues/23616)（Open，2026-04-21，bug/web/windows，已分配）— 几乎完全重复
   - [#23321](https://github.com/sst/opencode/issues/23321)（Open）— 明确提到 desktop 端 SSE 事件到达不可靠
   - [#19182](https://github.com/sst/opencode/issues/19182)（Open）— desktop 文件树 git 变更不更新
   - [#18504](https://github.com/sst/opencode/issues/18504)（Open）— web 文件树 git 新增目录不刷新
   - [#14449](https://github.com/sst/opencode/issues/14449)（Closed as discussion）— 此前的 feature 形态请求被关闭
5. **维护者倾向**：bug-framed 报告会被认领处理；feature-framed 请求（#14449）被关闭为讨论。→ **本次必须 frame 为 bug，且强调是对已有 SSE 基础设施的小修补，不是引入新能力**。

### 精确代码定位

| 文件 | 作用 |
|---|---|
| `packages/app/src/context/file/watcher.ts` | SSE 事件前端处理（根因在这里） |
| `packages/app/src/context/file/tree-store.ts` | 文件树状态管理（注入 `list` 函数） |
| `packages/app/src/components/file-tree.tsx` | SolidJS 文件树组件（展开/懒加载触发处，约 265-335 行） |
| `packages/app/src/pages/session/session-side-panel.tsx` | 右侧面板宿主 |

### 复现最小步骤

1. 启动 opencode desktop，打开任意 session
2. **保持右侧文件树默认状态**（重点：**不要**展开目标目录 `src/foo/`）
3. 在终端 / 文件管理器执行 `touch src/foo/new-file.md`
4. 展开 `src/foo/` 目录
5. **观察**：`new-file.md` 不出现
6. F5 / 重启应用后再展开 → 出现

与 #23616 的对照点（需提交前核对）：
- #23616 是否区分 "未展开" vs "已展开" 目录？
- #23616 是否提到 `invalidateFromWatcher` 的具体判断？
- 若 #23616 只是概括 "不实时"，**本文的精确根因定位就是增量价值**，可作为评论发；若 #23616 已经定位到同一行代码，**只追加我的方案倾向和 PR 意愿即可**。

---

## 路径 A — 在 #23616 下发评论（首选）

**评论正文（中文草稿，发前按需译为英文）**：

```markdown
+1 — 桌面端（Tauri）同样复现，补充一点前端侧的精确定位，看能不能加速这个 issue 的推进。

## 根因定位

`packages/app/src/context/file/watcher.ts` 的 `invalidateFromWatcher` 在处理 `add` / `unlink` 事件时有这段：

```ts
if (!ops.isDirLoaded(parent)) return
ops.refreshDir(parent)
```

语义上这是一个"懒惰丢弃"：如果新建文件的父目录还没被用户展开过，SSE 事件就被直接吃掉。之后用户展开该目录时，`tree-store` 从缓存返回旧列表，于是"永远看不到新文件"——除非重启 app。

## 最小复现

1. 启动 desktop，打开 session，保持 `src/foo/` **未展开**
2. 外部执行 `touch src/foo/new.md`（SSE 事件此时到达但被丢弃）
3. 展开 `src/foo/` → 看不到 new.md
4. 重启 → 可见

## 方案建议（按侵入性由小到大）

**方案 1（最小）**：对未加载的 parent，不直接丢弃事件，而是把该 parent 标记为 "dirty"；下次该 parent 被展开时，`tree-store` 对 dirty 目录跳过缓存、强制重新调 `list()`。改动范围仅限 `watcher.ts` + `tree-store.ts` 的标记位。

**方案 2**：`add` 事件直接调用 `tree-store` 的一个新方法 `insertPendingChild(parent, name)`，不触发网络请求，只在内存的未加载树结构上打一个占位；用户展开时按常规流程加载真实列表（此时服务端返回的列表一定包含 new.md），占位被覆盖。

**方案 3（兜底可靠性，与 #23321 相关）**：给 tree-store 加一个"可见窗口复活"机制：窗口 focus 事件触发对所有已展开目录做一次低成本 `list()` 对比。这个能同时缓解 #23321 提到的 desktop SSE 偶发丢失问题，但代价是额外请求。

个人倾向方案 1 + 可选方案 3 作为 SSE 不可靠时的兜底。

## PR 意愿

如果方向 OK，我可以按方案 1 提一个 draft PR。等维护者确认方案方向再动手，避免白做。

相关 issue 可能要一并看：#23321（desktop SSE 可靠性）、#19182（git 变更未更新）、#18504（web 新增目录未刷新）——这些本质都是 watcher 事件路径上的不同漏洞。
```

---

## 路径 B — 独立 issue（仅在 #23616 被关闭 / 不适用时使用）

**标题**：`Bug: 文件树对"未展开目录中的外部新建文件"永不刷新（watcher.ts 中的 add/unlink 事件在 parent 未加载时被丢弃）`

**正文**：

```markdown
## 背景

opencode desktop 用户越来越多在 "local AI workstation" 场景下使用：AI 或外部脚本会在项目里新建文件，用户希望在右侧文件树里立刻看到。当前 sidecar 已通过 SSE `file.watcher.updated` 推事件、前端 `watcher.ts` 已订阅，基础设施完整——但有一个具体的前端漏洞导致部分场景下事件被静默丢弃。

这是对已有 watcher 链路的**增量修补**，不引入新依赖、不碰 Rust 端。

## 现状

- Sidecar：正常推 SSE `file.watcher.updated { file, event }`
- 前端：`packages/app/src/context/file/watcher.ts` 的 `invalidateFromWatcher` 处理 add/unlink 时有判断 `if (!ops.isDirLoaded(parent)) return`
- 后果：新建文件的父目录未被用户展开过 → 事件被丢弃 → 用户展开时从 tree-store 缓存读到旧列表 → 新文件永不出现

（本 issue **不覆盖** #23321 提到的 desktop SSE 事件送达可靠性问题——那是另一层问题；本 issue 限定在"事件已到达但前端丢弃"这一条路径。）

## 复现最小步骤

1. 启动 opencode desktop，打开任意 session
2. 保持文件树默认状态，**不要**展开 `src/foo/`
3. 终端执行 `touch src/foo/new-file.md`
4. 展开 `src/foo/` → `new-file.md` **不可见**
5. 重启 app 后展开 → 可见

**期望行为**：步骤 4 展开时应能看到 `new-file.md`。

## 方案提议

详见代码位置 `packages/app/src/context/file/watcher.ts`、`tree-store.ts`：

**方案 1（首选，最小侵入）**：对未加载的 parent，用一个 "dirty dirs" Set 做标记替代丢弃事件；`tree-store` 对 dirty 目录跳过缓存、强制重新 `list()`。改动范围 < 30 行。

**方案 2**：`tree-store` 增加 `insertPendingChild(parent, name)`，在未加载节点上记一个占位，展开时被真实列表覆盖。

**方案 3（可选兜底）**：窗口 focus 事件触发对已展开目录的刷新对比，能同时缓解 #23321 的 SSE 可靠性问题，但有额外请求代价。

## 我已理解到的设计约束

- `tree-store` 的懒加载设计本身是正确的——大仓库一次性全拉会很慢。所以**不能**改成 "add 事件到了就强制 `list(parent)`"，那会为了没展开的目录做无用请求。方案 1 / 方案 2 都保留了懒加载语义。
- Desktop 端 SSE 事件到达可靠性是另一个问题（见 #23321），本 issue 不试图解决它，但方案 3 能作为兜底。
- 本方案**不碰 Rust 端**，`packages/desktop/src-tauri/` 完全不变，不引入 `notify` 或其他 fs-watch crate。

## 待讨论

1. 方案 1 的 "dirty dirs" Set 是否应该持久化（比如 sessionStorage）？个人倾向**不持久化**——用户刷新页面本身就是强制重置。
2. `unlink` 事件的处理要不要对称升级？（未加载目录里的文件被删除，当前也会被丢弃；严格来说用户"从未看到过该文件"，影响较小）
3. 是否和 #19182 / #18504 / #23321 一起修？如果维护者愿意我可以在一个 PR 里覆盖多个场景。

## PR 意愿

方案方向确认后，可在 3-5 天内提 draft PR（方案 1 为主体 + 方案 3 作为可选开关）。等维护者先对齐方向，避免重做。
```

---

## 提交前检查清单

- [ ] `gh issue view 23616 --repo sst/opencode` 拉原文，**核对我的精确根因定位是否真是增量信息**
- [ ] 同样 view 一遍 #23321 / #19182 / #18504，确认本文档引用的语境无误
- [ ] 判断该走路径 A 还是 B（默认 A）
- [ ] 本地亲自跑一次「未展开目录 + 外部 touch」的复现，确认现象与本文描述一致（空口叙述的 bug 容易被维护者忽略）
- [ ] 若走路径 B，标题中 "Bug:" 前缀必须保留（维护者对 bug-framed 反应明显好于 feature-framed，这是从 #14449 被关 vs #23616 被分配的对比中看出的）
- [ ] 提交后在 `沟通记录.md` 记录 comment URL 或 issue 号 + 日期
