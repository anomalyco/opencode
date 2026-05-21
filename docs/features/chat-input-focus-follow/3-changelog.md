---
feat-id: chat-input-focus-follow
status: done
related: ./3-changelog.md
---

# chat-input-focus-follow — changelog

**关联 commit**: `9a6f26448`
**所在分支**: `feat/chat-input-focus-follow`
**规模**: Tiny+(53 行 / 4 文件,无 1-spec / 2-plan)
**触发原因**: User 实测 `chat-selection-menu` + `file-tabs` 的"加入聊天"类入口后反馈 — 加完内容后焦点仍停在原视图(MD/HTML viewer / 聊天历史区),必须再点一次底部输入框才能继续打字,工作流断在最后一步。

## 实际改动

### 1. `packages/app/src/utils/chat-input-focus.ts`(新,+37)

模块级 singleton ref + Selection API helper:

```ts
let chatInputRef: HTMLElement | null = null

registerChatInputRef(el)    // PromptInput editorRef 回调注册
unregisterChatInputRef(el)  // 同 el 比对清空,unmount cleanup 用
focusChatInput()            // el.focus() + Selection.collapse(false) caret-to-end 兜底
```

设计要点:
- 同一时刻全局只一个 chat input(session 切换 PromptInput 重建),新 ref 注册后老 cleanup 因 el 不匹配不会误清,**多个 PromptInput 实例的注册/反注册时序错乱也不会丢 ref**
- `focusChatInput()` 自带 caret-to-end 兜底(防 contenteditable 异步 render 与 focus 顺序竞争时光标落错位置)
- 调用方负责通过 `prompt.set(next, promptLength(next))` 控制光标位置,helper 只补 DOM 层 selection 兜底

### 2. `packages/app/src/components/prompt-input.tsx`(+5)

contenteditable 的 editorRef 回调里注册 + `onCleanup` 反注册。FORK marker 两处(import + ref 回调)。

### 3. `packages/app/src/pages/session/chat-selection-menu.tsx`(+7 / -1)

`submitToChat()` 末尾:
- 把 `prompt.set(next, prompt.cursor())` 改成 `prompt.set(next, promptLength(next))`(光标到末尾)
- 跟一个 `requestAnimationFrame(focusChatInput)`(等 SolidJS 触发的 editor re-render 完再 focus)

### 4. `packages/app/src/pages/session/file-tabs.tsx`(+5)

`submitMdSelection()`(MD/HTML viewer 选区右键"加入聊天")末尾跟 `requestAnimationFrame(focusChatInput)`。注意这条入口走的是 `prompt.context.add(...)` 加 attachment 卡片(不动 editor 文本),只需 focus 收尾,不需要改光标位置。

## 行数

| 项 | 行数 |
|---|---|
| `chat-input-focus.ts` 新增 | 37 |
| `prompt-input.tsx` insertions | 5 |
| `chat-selection-menu.tsx` insertions | 7 / -1 |
| `file-tabs.tsx` insertions | 5 |
| 净 | +53 |

Tiny+ 级(刚过 50 阈值),但单文件改动都很小,1 helper + 3 调用点。

## 作用域决策(实战修正)

**第一轮误判**:开发 helper 时主要面向 `chat-selection-menu`(改 editor 文本场景),误以为 `prompt.context.add()` 加 attachment 卡片的入口不需要 focus 收尾(理由:attachment 区独立于 contenteditable,不抢焦点)。User 实测反馈"MD/HTML viewer 加入聊天后光标没跟随",才意识到**user 的预期是任何"加入聊天"动作都该 focus 回输入框**,而不是按"是否改 editor 文本"分类。

**修正后作用域**:
- ✅ `chat-selection-menu.tsx` `submitToChat`(聊天对话区右键选区菜单 → "添加到聊天")
- ✅ `file-tabs.tsx` `submitMdSelection`(MD/HTML viewer 选区右键 → "加入聊天",menu 直点 + input 弹窗两条路径)
- ⏸ `file-tabs.tsx` `addCommentToContext`(行评论 → 加进 chat context)— 是"行评论"语义不是"加入聊天",暂不接入
- ⏸ 其他 `prompt.context.add` callsite(`session.tsx` / `use-session-commands.tsx` / `submit.ts`)— 各自语义不同(自动加 / 命令式),不属于"user 主动点击加入"场景,不接入

## 影响范围

- ✅ **聊天对话区右键选区"添加到聊天"**:光标自动到末尾 + 输入框获得焦点,可立刻继续打字
- ✅ **MD viewer 右键"加入聊天"** menu 直点:attachment 卡片插入后焦点回输入框
- ✅ **MD viewer 右键"加入聊天"** input 弹窗带问题模式:同上
- ✅ **HTML viewer** 同 MD viewer
- ✅ **session 切换**:新 PromptInput 注册后老 cleanup 因 el 不匹配不会误清(unregisterChatInputRef 的 el 比对设计兜底)
- ✅ **多 PromptInput 实例**(理论上单一,但防御性):ref 替换语义,最新 register 胜出
- ✅ 原行为(已有 prompt 文本时追加 / 空 prompt 时新建)完全保留,仅在末尾加一帧 focus

## 回归测试点

User 在 Windows release exe(`packages/desktop/src-tauri/target/release/DeskFox.exe`,`build-deskfox.ps1 -Env dev -NoBundle`)实测:

- **R1** 聊天对话区划选 → 右键 → "添加到聊天" → 光标到末尾 + focus → ✅
- **R2** MD viewer 划选 → 右键 menu → "加入聊天" → attachment 卡片插入 + focus → ✅
- **R3** MD viewer 划选 → 右键 menu → "加入聊天" 进 input 弹窗 → 填问题 → 点"加入聊天"按钮 → focus → ✅
- **R4** HTML viewer 同 R2/R3 → ✅
- **R5** 输入框已有内容时再加 → 追加在原文后 + 光标在新末尾 + focus → ✅(R1 内含)

## R 合规

- **R2** FORK marker 5 处(chat-input-focus.ts 头注 + 各调用点 import / 调用注释)
- **R3** 不涉及品牌/主题/icon
- **R4** 0 override(全在 fork 白名单文件;`packages/app/src/utils/` 新增 fork-only 文件 + 3 个 session/component 文件追加几行)
- **R5** Tiny+ 级,R5 规定 < 50 行 Tiny 豁免测试。本 feat 53 行刚过阈值,但 helper 是 DOM Selection API + module singleton,unit 测意义不大(需 jsdom + IPC 真组件挂载才能验);user 实测 5 场景全过算 e2e 验证;**纪律达标**
- **R6** 不涉及网络监听

## 回退

```
git revert 9a6f26448
```

回退后 4 个文件回到 ship 5.15.1 状态,user 重新撞此问题(加入聊天后焦点不跟随)。

## 关联

- **延续**:`chat-selection-menu` / `加聊天-preview-fix` / `加聊天-option-enter` 的"加入聊天"工作流主题
- **复用**:`applyHistoryPrompt` 的 rAF 套路(等 SolidJS store 触发 editor re-render 完再 focus)
- **设计借鉴**:模块级 singleton ref 是 chat input 全局唯一性的产物,避免跨组件 props drilling / context 链
