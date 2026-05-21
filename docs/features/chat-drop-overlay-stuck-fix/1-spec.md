---
feat-id: chat-drop-overlay-stuck-fix
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# chat-drop-overlay-stuck-fix — 1-spec

> Bug fix:聊天窗口拖拽接收浮层无法关闭(2026-05-18 user 报告,2026-05-21 实施)

## 需求来源

2026-05-18 user 入需求池(`OPENCODE-PLAN/需求池/聊天窗口-拖拽浮层无法关闭.md`)— 报告"功能坏了"级 bug,不是体验优化:

> 当在文件目录树拖动文件的时候,聊天窗口就会展示成准备接收拖拽文件的样式。如果没有把对应的内容拖拽到聊天窗口,释放文件之后,聊天窗口的浮层无法去除。

User 视觉上以为 app 挂了 — 聊天输入框周围 `border-icon-info-active border-dashed` 浮层 + 半透明蒙板永久显示,无法继续打字 / 发消息。

## 现象拆解

| 现象 | 触发路径 | 行为 |
|---|---|---|
| 内部文件树拖拽触发外部接收浮层 | file-tree 拖文件 → 聊天窗口 | 浮层激活(**by design** — 见 `file-tree-multi-drag-to-chat` feat,多选拖到聊天是产品能力)|
| **浮层无法关闭** | 同上,释放后浮层卡死 | **bug 本体** — `setDraggingType(null)` 不执行 |

## 验收标准(P-级 happy path)

| ID | 场景 | 期望 |
|---|---|---|
| A1 | 文件树拖单文件到聊天输入框 → drop | 浮层消失,文件进 attachment 区 |
| A2 | 文件树拖文件,释放在文件树自己的某个文件夹行(误操作)| 浮层消失,文件进 file-tree 目标文件夹(file-tree-dnd 移动) |
| A3 | 文件树拖文件,中途按 Esc 取消 | 浮层消失 |
| A4 | 文件树拖文件,拖到不接收的标题栏 / 边缘释放 | 浮层消失 |
| A5 | 从 Windows 资源管理器拖图片到聊天 → drop | 浮层消失,图片进 attachment 区 |
| A6 | 从资源管理器拖图片释放在文件树文件夹上 | 浮层消失,文件被复制到 file-tree 目标(外部文件 drop)|
| A7 | 已有 attachment 时再拖,流程不破 | 浮层消失,新 attachment 追加 |
| A8 | 拖完循环可重复 | 浮层 null → image → null → image,不 stuck |

## 架构选型

### 候选方案对比

| 方案 | 改动 | 风险 |
|---|---|---|
| **A. 让 file-tree.tsx 行 onDrop 不 stopPropagation** | 改 file-tree.tsx | 高 — file-tree 自己的 drop 处理依赖 stopPropagation 防其他 root drop handler 误触 |
| **B. 在 file-tree.tsx onDrop 末尾显式调 attachments cleanup** | 跨模块耦合 | 中 — file-tree 不该知道 attachments 的存在;违反 P1 隔离 |
| **C. window 级 capture-phase drop + dragend 双兜底**(**采用**)| attachments.ts +13 行 | 低 — 单文件改;capture 阶段不被 stopPropagation 杀;ONLY 清状态不动 drop 处理 |
| D. 改 handleGlobalDragLeave 用 dragenter/dragleave counter 模式 | attachments.ts ~20 行 | 中 — counter 模式对 child crossing 更可靠,但仍解决不了 file-tree stopPropagation 杀 drop 的问题(counter 在 drop 时也要清零) |

**选 C 理由**:
- **作用域最小**:1 文件 / +13 行
- **正交无侵入**:不动 file-tree.tsx,不动其他 drop handler
- **覆盖完整**:capture-phase drop 覆盖外部 OS drag 落到 stopPropagation 子元素;dragend bubble 覆盖内部 drag 任意终止(Esc / 拖出 / drop 到非 drop zone)
- **belt-and-suspenders**:`handleGlobalDrop` 里原 `setDraggingType(null)` 保留,与新 capture 兜底重复但无害

### 事件流前置假设(写测试时验证)

1. **child 元素 bubble 阶段 stopPropagation 不杀 window capture**:DOM spec 标准行为,capture 阶段在 bubble 之前
2. **dragend 在 source 元素 fire 后 bubble 到 window**:HTML5 DnD spec 标准行为

两个假设 happydom + bun:test 实测验证(`drag-overlay-cleanup.test.ts`)。

## R 合规预判

- **R2** FORK marker 2 处(helper 定义 + onMount 注册段)
- **R3** 不涉及
- **R4** 0 override(`packages/app/src/components/prompt-input/` 已在 fork 白名单)
- **R5** **bug-repro 测试先行**,fix + test 同 commit,message 标 `[bug-repro: <一句话>]`(R5 修 bug 硬要求)
- **R6** 不涉及
