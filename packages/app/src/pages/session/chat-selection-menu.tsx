// FORK: 聊天对话区右键选区菜单 — 2026-05-24 重构为 ContextMenuHost 薄壳
// [feat: office-选中加聊天] 2026-05-24
//
// 历史:
// - 2026-05-15 [feat: chat-selection-menu] 首次实装,258 行包含完整 UI / 选区跟踪 / 菜单两态 / toast / focus 逻辑
// - 2026-05-21 [feat: chat-input-focus-follow] focus helper 抽出
// - 2026-05-24 [feat: office-选中加聊天] 重构 — UI 全部下沉到 @/utils/context-menu-host/host.tsx
//
// 当前文件 ≈ 入口薄壳:`<ChatSelectionMenu />` 仍是 message-timeline.tsx 的挂载点,
// 内部委派给 ContextMenuHost + DomSelectionProvider。chat-log + PDF/office 两处右键统一处理。
// MD viewer 不在 v1 范围 — 留 v2 跟 CodeMirror 一起做(详 docs/features/office-选中加聊天/1-spec.md)。

import { ContextMenuHost } from "@/utils/context-menu-host/host"
import { DomSelectionProvider } from "@/utils/context-menu-host/dom-provider"

// 模块级 singleton:DomSelectionProvider 实例无状态,全 app 共享一份即可。
const DOM_PROVIDER = new DomSelectionProvider()

/**
 * 聊天对话区右键选区菜单入口(透明迁移到 ContextMenuHost)。
 *
 * 接入点 = message-timeline.tsx 根布局挂载点。Host 内部 document-level capture 监听 contextmenu,
 * 按 Provider 列表 first-match-wins 路由。v1 唯一 Provider 是 DomSelectionProvider,覆盖
 * chat 对话区(`[data-slot="session-turn-list"]`)+ PDF/office 预览区(`[data-slot="pdf-viewer"]`)。
 *
 * 行为承继 2026-05-15 原版,1:1 复刻:
 * - menu / input 双模、Ctrl/Cmd+Enter(Mac Opt+Enter)提交、红色 highlight overlay
 * - Esc / 点空白关闭、composer 末尾追加引用块 + focus chat input、toast 通知
 *
 * 详细架构见 docs/features/office-选中加聊天/{1-spec.md,2-plan.md}。
 */
export function ChatSelectionMenu() {
  return <ContextMenuHost providers={[DOM_PROVIDER]} />
}
