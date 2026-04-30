---
feat-id: 查看器-自动刷新
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 查看器-自动刷新 — spec

## 触发原因

User 反馈:在文件查看器打开 `.md` 文件 → 通过聊天让模型修改该文件 → 模型 Edit/Write 工具写完磁盘 → **查看器仍显示旧内容,需 F5 / Ctrl+R 手动刷新页面才能看到改动**。

链路调研:

- **server 端事件本来双链路设计**:① `file.watcher.updated`(`@parcel/watcher` 监听 OS,`OPENCODE_EXPERIMENTAL_FILEWATCHER=true` 已在 `cli.rs:382` 注入到 sidecar);② `file.edited`(`Edit / Write / ApplyPatch` 三个 tool 写完直接 `bus.publish(File.Event.Edited, ...)`,无 OS 依赖)
- **client 端只听其一**:`packages/app/src/context/file/watcher.ts:19` 写死 `if (event.type !== "file.watcher.updated") return`,**`file.edited` 直接被丢弃**
- 这意味着对于 AI 写文件这条最高频路径,客户端**完全依赖 OS watcher 兜底**;Windows 上 ReadDirectoryChangesW 已知有 buffer 满 / 短路径覆写漏报的边缘问题,加上 Tauri sidecar 写文件路径可能与 client `path.normalize` 后的 hasFile/isOpen 比对失败,任意一环都会让自动刷新失效

server 已经为这场景专门定义并发了 `file.edited` 事件,client 漏挂监听是事实层面的"漏接信号"。

## 验收标准

- [ ] **R1 主路径** — 文件查看器打开 `.md` 文件 → 聊天让模型 Edit / Write 同一文件 → 查看器**秒级**(<2s)自动显示新内容,无需手动刷新
- [ ] **R2 多格式** — `.py` / `.html` / `.ts` / `.json` 同样自动刷新
- [ ] **R3 ApplyPatch** — 模型走 `apply_patch` 工具(多文件批改)→ 所有打开的 tab 都自动刷新
- [ ] **R4 编辑态保护** — 用户正在文件查看器编辑模式中(有未保存 draft)→ 模型同时改了同一文件 → **不覆盖用户草稿**,而是弹 toast 提示"AI 修改了此文件,你的草稿保留;保存时会让你选择是否覆盖"(沿用现有 mtime conflict 弹窗机制)
- [ ] **R5 外部编辑兜底** — 用户在 VSCode / 系统记事本里改文件 → 查看器仍能在 OS watcher 触发后刷新(原 `file.watcher.updated` 路径不破坏)
- [ ] **R6 重复刷新无副作用** — `file.edited` 与 `file.watcher.updated` 同一次 AI 写会都触发,`load` 的 `inflight` Map 去重应正常 work,不出双重网络请求

## 不做什么

- **不做"模型写文件冲突可视化合并 UI"** — 当前已有 mtime conflict 二选一弹窗(覆盖 / 重载),足够。三方合并 UI 是另一个量级的工程。
- **不动 `OPENCODE_EXPERIMENTAL_FILEWATCHER` 实验性 flag** — 它已在 Tauri sidecar 强开,server 端是否升级为 stable 不在 fork 决策范围。
- **不改文件树自动刷新逻辑** — `file.edited` 是单文件事件,不带目录信息,目录树仍走 `file.watcher.updated` 的 add/unlink/change 路径(已实现)。
- **不做"AI 写后自动滚到 diff 处"** — 是 nice-to-have,本次不做,等用户实际报"找不到改了哪"再加。
- **不动 server 端代码** — 双事件源已经在 server,本次只改 client 端漏接。

## 架构选型

走"**双链路双责任**":

- 主路径 `file.edited`(直发,无 OS 依赖):覆盖 AI 写文件的高频场景。客户端 watcher.ts 加一条独立分支处理。
- 兜底路径 `file.watcher.updated`(OS 监听):覆盖外部编辑(用户用其他工具改文件)。原代码不动。

外加**编辑态保护**:

- 在 `useFile` context 上加 `markDirty(path, dirty)` / `isDirty(path)` 注册接口
- `FileTabContent` 在 `editing()` / `dirty()` 状态变化时调 `markDirty`
- 两个 reload handler(`file.edited` 和 `file.watcher.updated`)都先查 `isDirty(path)`,true 则跳过 `loadFile` 并弹 toast,**保留用户 draft**
- 这层保护对原有 watcher 路径也补上(目前 watcher 路径也会无脑覆盖 draft,虽然概率低,但既然加了顺便补)

理由:`file.edited` 设计就是 server 给客户端的"我改了文件,你刷新"信号,client 漏挂监听是单纯的代码缺失;OS watcher 仍是外部编辑的正解,不能删。编辑态保护是必要的,否则 fix 直接引入"AI 写覆盖用户草稿"的数据丢失风险,比 bug 本身更糟。

## 关联

- 现有 server 事件定义:`packages/opencode/src/file/index.ts:79`(`file.edited`)+ `packages/opencode/src/file/watcher.ts:27`(`file.watcher.updated`)
- 现有 client 监听:`packages/app/src/context/file/watcher.ts:19`(只过滤 `file.watcher.updated`)
- 现有 mtime conflict 处理:`packages/app/src/pages/session/file-tabs.tsx:400-433`(`saveEdit` 检测 `mtime_conflict` 弹 confirm)
