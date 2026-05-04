---
feat-id: file-tree-ux-polish
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# file-tree-ux-polish — Spec

> 起草日期:2026-05-04
> **锁版日期:2026-05-04**(user 二轮 ack 完成,6 个开放点全部决议,见 §5)
> 规模:**Medium**(预估 ~200-450 行,跨 3-5 个 fork-only 文件,0 上游侵入)
> 主题:文件树 UX 一揽子优化(自动刷新 + 右键菜单重整 + 默认状态 + 键盘导航)

---

## 1. 背景与动机

`feat/file-tree-dnd`(2026-04-27 ~ 2026-04-29)落地后,右侧文件树具备 mini-Finder 级别能力(多选 / 拖放 / 剪贴板 / undo)。日常使用暴露 5 个 UX 缺口,本笔一次性修复:

1. LLM 整理完文件后**树不自动刷新**,需手动右键刷新才看到结果
2. 节点右键菜单**分组混乱**(打印项无意义占位 / 复制路径缺失 / 刷新缺失)
3. 空白处右键菜单同样需重整 + 现有刷新可能不真重载
4. 新项目打开时右侧面板**默认收起 + tab 默认在"0 更改"**,与"工作流以全文件视图为主"实情不符
5. 树**键盘导航全缺**(↑↓ / Enter / F2 / Delete 都不生效)

---

## 2. 5 项需求详细规格

### 需求 #1 — 自动刷新(LLM 响应结束触发)

**触发条件**:监听 `sync.data.session_status[currentSessionId].type` 从 `"busy"` → `"idle"` 的状态切换(packages/app/src/context/global-sync/event-reducer.ts:179-182)。

**行为**:
- 切换发生时调用 `file.tree.refresh(rootRel)`,递归重载当前打开目录的所有已展开节点
- **静默刷新**(不弹 toast,不抖动 UI;子目录的展开状态保留)
- 即使响应失败 / 中断也触发(只看状态切换,不区分是否成功)

**作用范围**:右侧面板**当前可见时**才触发(面板收起时挂监听浪费,面板展开瞬间会自然 mount → reload)。

**已知不做**:
- ❌ 文件系统级 watcher(投入大,跨平台行为差异)
- ❌ tool call 粒度细化触发(改频繁,不直观)
- ❌ 仅在 LLM 改了 cwd 内文件时刷新(实现复杂,粗粒度先够用)

**验收**:
- 打开 session,让 LLM 跑一个写文件 / 改文件 / 删文件的任务
- 响应结束瞬间,树自然反映新结构 — 无需手动刷新
- 多次提问连续刷新不抖动

---

### 需求 #2 — 节点右键菜单重整

**当前状态**(`packages/app/src/components/file-tree.tsx:811-860`):
```
重命名 / 在文件夹中显示 / 打印
─────
剪切 / 复制 / [粘贴]
─────
删除
─────
新建文件 (.md) / 新建文件夹
```

**目标状态**(4 组):
```
[组 1] 重命名 / 复制 / 剪切 / 删除
─────
[组 2] 在文件夹中显示 / 复制文件路径
─────
[组 3] 新建文件 / 新建文件夹
─────
[组 4] 刷新
```

**逐项变更**:
| 变更 | 操作 | 备注 |
|---|---|---|
| 删"打印" | 移除 line 824-826 | window.print() 在文件树场景无意义 |
| 删"粘贴到 X"项 | **保留**,但融入组 1 顺序中 | 不在 user 4 组明示中,作为剪切/复制配套保留(clipboard 非空时显示);**位置:组 1 末尾 "删除" 之前** — 因为粘贴是剪切/复制的对偶操作 |
| 加"复制文件路径"(组 2) | 新增 ContextMenu.Item | 行为:`navigator.clipboard.writeText(target.absolute)` + toast "已复制路径";单选场景按当前节点;多选场景按多行换行拼接所有路径 |
| 加"刷新"(组 4) | 新增 ContextMenu.Item | 调 `file.tree.refresh(target.path)` 若是文件夹,否则刷新父目录(`dirname(target.path)`) |
| 改"新建文件 (.md)" → "新建文件" | **仅文案改**,defaultValue **保留** | 菜单文案去 `(.md)` 字样;**defaultValue 仍 `untitled.md`**(用户使用场景以 markdown 为主,默认 .md 一键创建合理);placeholder 简化为 `"文件名"` 即可(去掉"默认 .md"提示,因 defaultValue 已直观)|

**组顺序变更**(对比 user 给的 4 组):
- 用户给:**重命名/复制/剪切/删除** — 注意**复制在剪切之前**(与系统资源管理器一致),当前代码是剪切/复制顺序,要调换
- "粘贴"放进组 1 哪里:User 没明示,我建议放在 **删除前**(与剪切/复制相邻)。如 user 反对放在组 1,可改放组 2 末或独立组。

**验收**:
- 节点右键弹菜单,4 组顺序 = 1 重命名/复制/剪切/[粘贴]/删除 → 2 在文件夹中显示/复制文件路径 → 3 新建文件/新建文件夹 → 4 刷新
- "复制文件路径":Mac 出 `/abs/path`,Win 出 `C:\abs\path`(无引号无 `file://`)
- "新建文件" 弹框默认值是 **`untitled.md`**(保留默认 markdown),placeholder 是"文件名"
- "打印" 项不再出现

---

### 需求 #3 — 空白处右键菜单重整

**当前状态**(`file-tree.tsx:862-885`):
```
新建文件 (.md) / 新建文件夹 / [粘贴到项目根]
─────
刷新
```

**目标状态**(2 组):
```
[组 1] 新建文件 / 新建文件夹
─────
[组 2] 刷新
```

**逐项变更**:
| 变更 | 操作 |
|---|---|
| "新建文件 (.md)" → "新建文件" | 同需求 #2(去 .md 默认值)|
| "粘贴到项目根" | **保留**,放组 1 末尾(剪贴板非空时显示)— 与节点菜单"粘贴"对齐 |
| "刷新"功能修复 | 当前 `file.tree.refresh(rootRel)` 已存在,但 user 反馈"刷新但展示没刷新"。**修复方向**:① 检查 refresh 实现是否真重新拉子节点 list 还是仅 invalidate 缓存 ② 若仅 invalidate,需补一次 force re-list ③ 同时刷新所有当前展开的子目录(递归 expand 状态保留) |

**验收**:
- 空白处右键弹菜单,2 组:1 新建文件/新建文件夹/[粘贴]→ 2 刷新
- 树外有改动(终端 / LLM)→ 点刷新 → 树立刻反映新内容(不需收起再展开)
- 当前已展开的子目录刷新后**仍保持展开**

---

### 需求 #4 — 默认显示文件树 + 默认所有文件 tab

**两处默认值修改**:

1. `packages/app/src/context/settings.tsx:111` — `showFileTree: false` → `true`
   - 影响:新用户 / 重置 settings 后,右侧文件树面板**默认显示**(不收起)
   - 已有用户 settings 已持久化为 false 的,**不强制覆盖**(尊重用户已有偏好);只对未触碰过此 setting 的用户生效

2. `packages/app/src/context/layout.tsx:250` 和 `:623`(fallback)— `"changes"` → `"all"`
   - 影响:新用户 / 重置 layout 后,tab 默认在 **"所有文件"**
   - 已持久化的不覆盖(同上)

**验收**:
- 全新装 / 清 localStorage 后启动 → 右侧面板已展开 → tab 在"所有文件"
- 已有用户:不变(各自尊重已持久化值)
- 截图所示首层目录可见(文件树 mount 后根节点子目录平铺展示,这是当前默认行为,无需额外改)

---

### 需求 #5 — 键盘导航(↑↓ / Enter / F2 / Delete)

**焦点逻辑**(已对齐):
- **触发条件**:树内 `selection.paths().length > 0`(任意节点高亮即视为树有焦点)
- **不抢键盘的边界**:`event.target` 落在 `<input>` / `<textarea>` / `[contenteditable]` 内时,完全 no-op
- 不做显式 DOM focus 移交(避免与编辑器 / 聊天框抢)

**4 个键的行为**:

| 键 | 行为 | 说明 |
|---|---|---|
| ↑ | 选中**上一可见节点** | "可见"= 在已展开父节点链下;在树顶时 no-op;Shift+↑ 不实现(暂留)|
| ↓ | 选中**下一可见节点** | 同上;Shift+↓ 不实现 |
| Enter | 单选时:① 文件 → 触发 onFileClick(打开)② 文件夹 → toggle 展开 | 多选时:no-op(避免误触)|
| F2 | 单选时调用 `promptRename(target)`(已存在函数)| 多选时:no-op(批量重命名不做)|
| Delete | 调用 `promptDelete(target)`(已存在),支持单选 / 多选批量 | **macOS 额外绑 Backspace**(macOS 习惯,Backspace 在 Finder 即删除)|

**实现位置**:`packages/app/src/hooks/use-file-tree-shortcuts.ts`(第 43-91 行已有 keydown handler,扩展即可)。

**↑↓ 导航的"可见节点序列"如何拿**:
- 文件树状态在 `tree-store`(context/file/tree-store.ts),当前已有 `nodes()` memo 返回平铺顺序(file-tree.tsx:999-1056)
- 计划:在 selection-store 暴露一个 `getVisibleSequence()`,或直接用 `nodes()` 的当前 array 计算 `currentIndex ± 1`

**验收**:
- 任选一节点,按 ↑↓ → 高亮在可见节点间移动
- Enter 文件 → 编辑器打开;Enter 文件夹 → 展开/折叠
- F2 → 弹重命名框
- Delete → 弹删除确认(批量删除多选)
- 焦点在聊天输入框时按上述键 → **完全无影响**(输入框的 ↑↓ Enter 行为正常)
- 没有任何 selection 时按上述键 → no-op(不报错,不响应)

**↑↓ 不自动展开折叠节点**:遇到折叠的父节点,只在该父节点本身可见的层级里上下移动,不强制展开它的子树(避免行为反直觉)。

---

## 3. 涉及文件清单

| 文件 | 改动性质 | 行数估 |
|---|---|---|
| `packages/app/src/components/file-tree.tsx` | 重整菜单 + 加复制路径/刷新项 + 改默认值 | ~80 |
| `packages/app/src/hooks/use-file-tree-shortcuts.ts` | 加 ↑↓/Enter/F2/Delete | ~120 |
| `packages/app/src/pages/session/session-side-panel.tsx` 或 message-timeline.tsx | 监听 session_status 自动刷新 | ~30 |
| `packages/app/src/context/settings.tsx` | showFileTree default true | ~1 |
| `packages/app/src/context/layout.tsx` | tab default "all" | ~2 |
| **(可能)** `packages/app/src/context/file/tree-store.ts` | refresh 强制 re-list 修复 | ~10-30 |

**总估**:200-260 行(若 tree-store refresh 修复复杂可能到 350)。

**0 上游侵入**(所有文件都是 fork-only / fork 加的,见 file-tree-dnd 历史)。

---

## 4. 决策汇总(已对齐)

| Q | 答 |
|---|---|
| feat-id | `file-tree-ux-polish` |
| 自动刷新触发 | 整轮 LLM 响应结束(busy → idle 状态切换)|
| 复制路径格式 | 平台原生绝对路径(无引号无前缀)|
| 默认状态 | 面板默认显示 + tab 默认 "所有文件" |
| 键盘焦点 | 树内 selection 非空 = 树有焦点;输入框/编辑器内不抢 |

---

## 5. 二轮开放点决议(2026-05-04 锁版)

| # | 问题 | 决议 |
|---|---|---|
| A | "粘贴"项在节点菜单放哪里 | **组 1 删除前**(与剪切/复制相邻)|
| B | "新建文件" defaultValue | **保留 `untitled.md`**(用户场景以 markdown 为主,菜单文案去 "(.md)" 字样,行为不变)|
| C | 多选"复制文件路径"格式 | **`\n` 多行拼接**(不限制单选)|
| D | 已有用户 localStorage 迁移 | **不迁**(尊重既有偏好,新默认仅对新用户/重置后生效)|
| E | macOS 额外绑 Backspace = Delete | **绑**(macOS 习惯)|
| F | ↑↓ 折叠下不可见节点自动展开父 | **不做**(简单版,避免反直觉)|

**spec 锁版,进入 2-plan.md 起草 + 实施阶段。**

---

## 6. 不在本笔范围

- 树内搜索 / 过滤(独立 feat,后续)
- git 状态徽章(独立 feat,后续)
- hidden file 切换(独立 feat,后续)
- 拖到外部应用(Tauri 限制,独立技术评估)
- Reveal in Tree(从编辑器反向定位)— **可考虑下一笔**
