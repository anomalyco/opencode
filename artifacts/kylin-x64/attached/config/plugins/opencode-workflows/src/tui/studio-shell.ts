/**
 * OpenCode Workflows —— Workflow Studio 壳层状态机（studio-shell.ts，纯函数，可独立测试）。
 *
 * `/workflows-studio` 全屏入口的「意图分流壳」纯逻辑：意图菜单 → 目标选择器 → 浏览详情 /
 * 删除确认 / 向导。与向导归约器 `create-state.ts` 同构——纯、不可变、确定性；`create-screen.tsx`
 * 作为薄渲染层把按键映射为 {@link StudioShellAction}，把 {@link StudioShellState} 投影为视图，
 * 异步 IO（discover / hasDraft / deleteUserWorkflow）留在渲染层，结果经 action 喂入。
 *
 * 设计依据：docs/WF-Studio统一与命令收敛方案.md（§4 交互流、§5 显示效果）。
 */

import type { WorkflowRegistryEntry } from "../extension/extension-system"
import type { WizardState } from "../types"
import { STUDIO_INTENTS, filterEntriesForIntent, type StudioIntentKey } from "./studio-types"

/** 向导模式（与 {@link WizardState.mode} 对齐）。 */
export type StudioWizardMode = WizardState["mode"]

/**
 * 壳层阶段：
 * - `intent`：意图菜单（5 选 1）；
 * - `pick`：目标 workflow 选择器（按意图过滤的候选，可能为空态）；
 * - `browse`：只读类型详情；
 * - `confirmDelete`：删除类型二次确认；
 * - `wizard`：进入现有 WizardState 向导（create / edit / edit-structure）。
 */
export type StudioPhaseKind = "intent" | "pick" | "browse" | "confirmDelete" | "wizard"

/** 壳层单一状态源。前进/后退仅由 reducer 产生新副本（不可变）。 */
export interface StudioShellState {
  /** 当前阶段。 */
  phase: StudioPhaseKind
  /** 已选意图（意图菜单阶段为 null）。 */
  intent: StudioIntentKey | null
  /** 全部已发现类型（discover 结果）。 */
  entries: readonly WorkflowRegistryEntry[]
  /** 有结构草稿的名集合（供 edit-structure 过滤；渲染层解析 hasDraft 后喂入）。 */
  draftNames: ReadonlySet<string>
  /** 当前意图下的候选（pick 阶段列表）。 */
  candidates: readonly WorkflowRegistryEntry[]
  /** 已选目标（browse / confirmDelete / wizard 阶段）。 */
  selected: WorkflowRegistryEntry | null
  /** 当前列表游标（intent 菜单或 pick 列表）。 */
  cursor: number
}

/** 壳层动作。 */
export type StudioShellAction =
  /** 列表游标移动（自动钳制到当前列表范围）。 */
  | { type: "MOVE"; delta: number }
  /** 确认当前游标项（语义随阶段：intent 选意图 / pick 选目标）。 */
  | { type: "ENTER" }
  /** 返回上一层（Esc）。intent 阶段为终点（由渲染层决定关闭 Studio）。 */
  | { type: "BACK" }
  /** 删除完成后刷新：更新 entries/draftNames，回到 pick 并重算候选。 */
  | { type: "DELETE_DONE"; entries: readonly WorkflowRegistryEntry[]; draftNames?: ReadonlySet<string> }
  /** 数据刷新（discover/hasDraft 重新拉取）：更新 entries/draftNames，pick 阶段重算候选。 */
  | { type: "REFRESH"; entries: readonly WorkflowRegistryEntry[]; draftNames?: ReadonlySet<string> }

/** 构造壳层初始状态（进入 Studio 即意图菜单）。 */
export function initStudioShell(
  entries: readonly WorkflowRegistryEntry[] = [],
  draftNames: ReadonlySet<string> = new Set(),
): StudioShellState {
  return {
    phase: "intent",
    intent: null,
    entries,
    draftNames,
    candidates: [],
    selected: null,
    cursor: 0,
  }
}

/** 当前阶段的列表长度（用于游标钳制）。 */
function listLength(state: StudioShellState): number {
  if (state.phase === "intent") return STUDIO_INTENTS.length
  if (state.phase === "pick") return state.candidates.length
  return 0
}

/** 把游标钳制到 [0, len-1]（len 为 0 → 0）。 */
function clampCursor(cursor: number, len: number): number {
  if (len <= 0) return 0
  if (cursor < 0) return 0
  if (cursor >= len) return len - 1
  return cursor
}

/** 意图在菜单中的下标（用于 pick→intent 回退时恢复游标）。 */
function intentIndex(intent: StudioIntentKey | null): number {
  if (!intent) return 0
  const idx = STUDIO_INTENTS.findIndex((i) => i.key === intent)
  return idx < 0 ? 0 : idx
}

/**
 * 壳层归约器（**纯函数**，不修改入参，确定性）。
 *
 * @param state 当前状态。
 * @param action 动作。
 * @returns 新状态（与入参深相等时也返回新对象，除非显式无变化）。
 */
export function reduceStudioShell(state: StudioShellState, action: StudioShellAction): StudioShellState {
  switch (action.type) {
    case "MOVE": {
      if (state.phase !== "intent" && state.phase !== "pick") return state
      const len = listLength(state)
      const next = clampCursor(state.cursor + action.delta, len)
      return next === state.cursor ? state : { ...state, cursor: next }
    }

    case "ENTER": {
      if (state.phase === "intent") {
        const intent = STUDIO_INTENTS[state.cursor]
        if (!intent) return state
        // 新建无需选目标 → 直接进向导（create 模式）。
        if (!intent.needsTarget) {
          return { ...state, phase: "wizard", intent: intent.key, selected: null }
        }
        const candidates = filterEntriesForIntent(state.entries, intent.key, { draftNames: state.draftNames })
        return { ...state, phase: "pick", intent: intent.key, candidates, cursor: 0, selected: null }
      }
      if (state.phase === "pick") {
        if (state.candidates.length === 0) return state // 空态：Enter 无效
        const target = state.candidates[clampCursor(state.cursor, state.candidates.length)]
        switch (state.intent) {
          case "browse":
            return { ...state, phase: "browse", selected: target }
          case "delete":
            return { ...state, phase: "confirmDelete", selected: target }
          case "config":
          case "edit-structure":
            return { ...state, phase: "wizard", selected: target }
          default:
            return state
        }
      }
      // browse/confirmDelete/wizard 的 Enter 由渲染层处理（IO/向导内部）。
      return state
    }

    case "BACK": {
      switch (state.phase) {
        case "intent":
          return state // 终点：由渲染层决定关闭 Studio
        case "pick":
          return {
            ...state,
            phase: "intent",
            cursor: intentIndex(state.intent),
            intent: null,
            candidates: [],
            selected: null,
          }
        case "browse":
        case "confirmDelete":
          return { ...state, phase: "pick", selected: null }
        case "wizard":
          // 向导返回意图菜单（无论 create/edit/edit-structure）。
          return {
            ...state,
            phase: "intent",
            cursor: intentIndex(state.intent),
            intent: null,
            candidates: [],
            selected: null,
          }
      }
    }

    case "DELETE_DONE": {
      const entries = action.entries
      const draftNames = action.draftNames ?? state.draftNames
      const candidates = state.intent
        ? filterEntriesForIntent(entries, state.intent, { draftNames })
        : []
      return {
        ...state,
        phase: "pick",
        entries,
        draftNames,
        candidates,
        selected: null,
        cursor: clampCursor(state.cursor, candidates.length),
      }
    }

    case "REFRESH": {
      const entries = action.entries
      const draftNames = action.draftNames ?? state.draftNames
      if (state.phase === "pick" && state.intent) {
        const candidates = filterEntriesForIntent(entries, state.intent, { draftNames })
        return { ...state, entries, draftNames, candidates, cursor: clampCursor(state.cursor, candidates.length) }
      }
      return { ...state, entries, draftNames }
    }
  }
}

/**
 * 派生：当前若处于 `wizard` 阶段，返回向导启动信息（模式 + 目标名）；否则 null。
 *
 * 模式映射：`create`→新建（无 name）；`config`→`edit`（仅改配置）；`edit-structure`→重写结构。
 */
export function studioWizardLaunch(state: StudioShellState): { mode: StudioWizardMode; name?: string } | null {
  if (state.phase !== "wizard") return null
  if (state.intent === "create" || state.intent === null) return { mode: "create" }
  if (state.intent === "config") return { mode: "edit", name: state.selected?.name }
  if (state.intent === "edit-structure") return { mode: "edit-structure", name: state.selected?.name }
  return { mode: "create" }
}
