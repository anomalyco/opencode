/** @jsxImportSource @opentui/solid */
/**
 * OpenCode Workflows —— sidebar_content 槽位工厂。
 *
 * 把「读取 Run 快照信号 → 渲染 {@link WorkflowPanelList}」的 JSX 封装在 `src/tui/` 内
 * （此目录下 JSX 运行时解析正常），使根级 `tui.tsx` 入口保持 **JSX-free**，仅负责
 * 数据接线（信号、文件监听、轮询、折叠状态）与槽位注册。
 *
 * 数据为**已排序的多 Run 快照数组**（running 优先、最近启动在前），由 tui.tsx 提供，
 * 使并发/连续启动的多个 workflow 同时可见，而非只显示最近一个。折叠状态（`Set<runId>`）
 * 与切换回调亦由 tui.tsx 维护并经此工厂注入。
 *
 * @see ../../tui.tsx — 调用本工厂注册槽位
 * Requirements: 10.1-10.6, 13.3
 */

import type { JSX } from "solid-js"
import type { TuiSlotContext } from "@opencode-ai/plugin/tui"
import type { RunSnapshot } from "../types"
import { WorkflowPanelList } from "./workflow-panel"

/** 槽位渲染回调签名：接收主题上下文与 props，返回 JSX 或 null。 */
export type SidebarSlotRenderer = (
  ctx: Readonly<TuiSlotContext>,
  props: { session_id: string },
) => JSX.Element | null

/**
 * 创建 sidebar_content 槽位渲染回调。
 *
 * @param snapshots 已排序的 Run 快照数组 accessor（在 JSX 中读取以保持响应式订阅）。
 * @param collapsed 已折叠 runId 集合 accessor（响应式）。
 * @param onToggle 点击某 Run 标题行的折叠切换回调。
 */
export function createSidebarRenderer(
  snapshots: () => RunSnapshot[],
  collapsed: () => ReadonlySet<string>,
  onToggle: (runId: string) => void,
): SidebarSlotRenderer {
  return (ctx) => (
    <WorkflowPanelList
      snapshots={snapshots()}
      theme={ctx.theme}
      collapsed={collapsed()}
      onToggle={onToggle}
    />
  )
}
