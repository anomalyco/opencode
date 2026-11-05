/** @jsxImportSource @opentui/solid */
/**
 * OpenCode Workflows —— Workflow Studio 全屏壳层（studio-screen.tsx）。
 *
 * `/workflows-studio` 的全屏路由承载组件：把 {@link StudioShellState} 投影为「意图菜单 →
 * 目标选择器 → 浏览详情 / 删除确认 / 向导」五个阶段视图，按键经 {@link reduceStudioShell}
 * 归约。`wizard` 阶段委托给既有 {@link CreateScreen}（create / edit / edit-structure 三态），
 * 由本壳层按所选意图与目标注入 `editName` / `editStructureName`。
 *
 * 范式同 `create-screen.tsx`：
 * - `useKeyboard` 首行守卫 `route.current.name !== STUDIO_ROUTE` 时不响应；
 * - `wizard` 阶段本壳层不响应按键（交给 CreateScreen），其余阶段本壳层处理；
 * - 全屏 `<box>` 取 `useTerminalDimensions()`；所有回调 try/catch，绝不向上抛（Issue #13461）。
 *
 * 异步 IO（discover / hasDraft / deleteUserWorkflow）在本层执行，结果经 action 喂入归约器。
 *
 * @see docs/WF-Studio统一与命令收敛方案.md
 */

import { For, Show, createMemo, createSignal, onMount, type JSX } from "solid-js"
import type { TuiPluginApi, TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { KeyEvent } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"

import type { WorkflowRegistryEntry } from "../extension/extension-system"
import { CreateScreen, STUDIO_ROUTE, type CreateScreenProps } from "./create-screen"
import { STUDIO_INTENTS, buildTypeDetail, type StudioIntentKey } from "./studio-types"
import {
  initStudioShell,
  reduceStudioShell,
  studioWizardLaunch,
  type StudioShellAction,
  type StudioShellState,
} from "./studio-shell"

type Theme = TuiThemeCurrent

/** 各意图在目标选择器顶部的标题与空态提示。 */
const PICK_TITLE: Record<StudioIntentKey, string> = {
  browse: "浏览类型 › 选择 workflow",
  create: "新建 workflow",
  config: "改配置 › 选择 workflow（含内置）",
  "edit-structure": "改结构 › 选择 workflow（仅带草稿的自定义）",
  delete: "删除类型 › 选择 workflow（仅自定义）",
}
const PICK_EMPTY: Record<StudioIntentKey, string> = {
  browse: "（未发现任何 workflow）",
  create: "",
  config: "（未发现任何 workflow）",
  "edit-structure": "（没有可编辑结构的自定义 workflow；先用「新建」创建，或改用「改配置」）",
  delete: "（没有可删除的自定义 workflow；内置类型不可删）",
}

/**
 * Studio 壳层注入式 props：在 {@link CreateScreenProps} 之上补充壳层所需的读/写端口。
 */
export interface StudioScreenProps extends CreateScreenProps {
  /** 发现全部 workflow 类型（内置 + 用户自定义）。 */
  discover: () => Promise<WorkflowRegistryEntry[]>
  /** 判定某 workflow 是否有结构草稿（edit-structure 过滤护栏）。未注入时该意图无候选。 */
  hasDraft?: (name: string) => Promise<boolean>
  /** 删除用户自定义类型源文件（delete 意图）。未注入时删除确认页 Enter 退回选择器。 */
  deleteUserWorkflow?: (scriptPath: string) => Promise<void>
}

/** route 注册入口（保持 tui.tsx JSX-free）。 */
export function renderStudioRoute(props: StudioScreenProps): JSX.Element {
  return <StudioScreen {...props} />
}

/** Workflow Studio 全屏壳层组件。 */
export function StudioScreen(props: StudioScreenProps): JSX.Element {
  const dim = useTerminalDimensions()
  const theme = (): Theme => props.api.theme.current
  const [shell, setShell] = createSignal<StudioShellState>(initStudioShell())

  function dispatch(action: StudioShellAction): void {
    setShell((s) => reduceStudioShell(s, action))
  }

  /** 拉取 entries + 解析 hasDraft 草稿名集合。 */
  async function loadData(): Promise<{ entries: WorkflowRegistryEntry[]; draftNames: Set<string> }> {
    const entries = await props.discover()
    const draftNames = new Set<string>()
    if (typeof props.hasDraft === "function") {
      for (const e of entries) {
        if (e.source !== "user") continue
        try {
          if (await props.hasDraft(e.name)) draftNames.add(e.name)
        } catch {
          // hasDraft 判定失败按「无草稿」处理（保守）。
        }
      }
    }
    return { entries, draftNames }
  }

  onMount(() => {
    void (async () => {
      try {
        const { entries, draftNames } = await loadData()
        dispatch({ type: "REFRESH", entries, draftNames })
      } catch {
        // discover 失败：保持空 entries，意图菜单仍可用（选目标时显示空态）。
      }
    })()
  })

  /** 删除确认 → 调用端口 → 重新发现 → DELETE_DONE 回到选择器。 */
  function confirmDelete(): void {
    const s = shell()
    const target = s.selected
    const del = props.deleteUserWorkflow
    if (!target || !del) {
      dispatch({ type: "BACK" })
      return
    }
    void del(target.path)
      .then(async () => {
        try {
          props.api.ui.toast({ variant: "success", title: "删除 Workflow 类型", message: `已删除：${target.name}` })
        } catch {
          /* toast 失败静默 */
        }
        try {
          const { entries, draftNames } = await loadData()
          dispatch({ type: "DELETE_DONE", entries, draftNames })
        } catch {
          dispatch({ type: "BACK" })
        }
      })
      .catch((e: unknown) => {
        try {
          props.api.ui.toast({
            variant: "error",
            title: "删除 Workflow 类型",
            message: e instanceof Error ? e.message : String(e),
          })
        } catch {
          /* toast 失败静默 */
        }
      })
  }

  const launch = createMemo(() => studioWizardLaunch(shell()))

  useKeyboard((evt: KeyEvent) => {
    if (props.api.route.current.name !== STUDIO_ROUTE) return
    const s = shell()
    if (s.phase === "wizard") return // 向导阶段交给 CreateScreen 自己的键盘处理
    try {
      const stop = (): void => {
        evt.preventDefault()
        evt.stopPropagation()
      }
      if (s.phase === "intent" || s.phase === "pick") {
        if (evt.name === "up") {
          stop()
          dispatch({ type: "MOVE", delta: -1 })
        } else if (evt.name === "down") {
          stop()
          dispatch({ type: "MOVE", delta: 1 })
        } else if (evt.name === "return") {
          stop()
          dispatch({ type: "ENTER" })
        } else if (evt.name === "escape") {
          stop()
          if (s.phase === "intent") props.onClose()
          else dispatch({ type: "BACK" })
        }
        return
      }
      if (s.phase === "browse") {
        if (evt.name === "escape" || evt.name === "return") {
          stop()
          dispatch({ type: "BACK" })
        }
        return
      }
      if (s.phase === "confirmDelete") {
        if (evt.name === "escape") {
          stop()
          dispatch({ type: "BACK" })
        } else if (evt.name === "return") {
          stop()
          confirmDelete()
        }
        return
      }
    } catch {
      // 键盘回调绝不向上抛（Issue #13461）。
    }
  }, {})

  const full = (): { w: number; h: number } => ({ w: dim().width, h: dim().height })

  return (
    <Show
      when={shell().phase === "wizard"}
      fallback={
        <box
          width={full().w}
          height={full().h}
          backgroundColor={theme().background}
          flexDirection="column"
          paddingLeft={1}
          paddingRight={1}
        >
          {renderShell()}
        </box>
      }
    >
      <CreateScreen
        {...props}
        editName={launch()?.mode === "edit" ? launch()?.name : undefined}
        editStructureName={launch()?.mode === "edit-structure" ? launch()?.name : undefined}
        editPhases={
          launch()?.mode === "edit"
            ? (shell().selected?.phases ?? []).map((p) => p.title).filter((t) => typeof t === "string" && t.length > 0)
            : undefined
        }
        onClose={() => dispatch({ type: "BACK" })}
      />
    </Show>
  )

  // ── 阶段视图渲染（intent / pick / browse / confirmDelete）──
  function renderShell(): JSX.Element {
    const s = shell()
    if (s.phase === "intent") return renderIntent(s)
    if (s.phase === "pick") return renderPick(s)
    if (s.phase === "browse") return renderBrowse(s)
    if (s.phase === "confirmDelete") return renderConfirmDelete(s)
    return <text fg={theme().textMuted}>…</text>
  }

  function renderIntent(s: StudioShellState): JSX.Element {
    return (
      <box flexDirection="column">
        <text fg={theme().accent}>Workflow Studio</text>
        <text fg={theme().textMuted}>选择要执行的操作：</text>
        <box flexDirection="column" paddingTop={1}>
          <For each={STUDIO_INTENTS}>
            {(item, i) => {
              const sel = (): boolean => i() === s.cursor
              return (
                <box flexDirection="row">
                  <text fg={sel() ? theme().accent : theme().text}>{sel() ? "▶ " : "  "}</text>
                  <text fg={sel() ? theme().accent : theme().text}>{item.label}</text>
                  <text fg={theme().textMuted}>{"   " + item.description}</text>
                </box>
              )
            }}
          </For>
        </box>
        <box flexDirection="column" paddingTop={1}>
          <text fg={theme().textMuted}>↑/↓ 选择   Enter 进入   Esc 退出 Studio</text>
        </box>
      </box>
    )
  }

  function sourceTag(e: WorkflowRegistryEntry): string {
    return e.source === "user" ? " (用户自定义)" : " (内置)"
  }

  function renderPick(s: StudioShellState): JSX.Element {
    const intent = s.intent as StudioIntentKey
    return (
      <box flexDirection="column">
        <text fg={theme().accent}>{"Studio · " + PICK_TITLE[intent]}</text>
        <Show
          when={s.candidates.length > 0}
          fallback={
            <box flexDirection="column" paddingTop={1}>
              <text fg={theme().textMuted}>{PICK_EMPTY[intent]}</text>
            </box>
          }
        >
          <box flexDirection="column" paddingTop={1}>
            <For each={s.candidates}>
              {(e, i) => {
                const sel = (): boolean => i() === s.cursor
                return (
                  <box flexDirection="row">
                    <text fg={sel() ? theme().accent : theme().text}>{sel() ? "▶ " : "  "}</text>
                    <text fg={sel() ? theme().accent : theme().text}>{e.name}</text>
                    <text fg={theme().textMuted}>{sourceTag(e) + "   " + (e.whenToUse ?? e.description)}</text>
                  </box>
                )
              }}
            </For>
          </box>
        </Show>
        <box flexDirection="column" paddingTop={1}>
          <text fg={theme().textMuted}>↑/↓ 选择   Enter 进入   Esc 返回意图菜单</text>
        </box>
      </box>
    )
  }

  function renderBrowse(s: StudioShellState): JSX.Element {
    const e = s.selected
    const lines = e ? buildTypeDetail(e).split("\n") : ["（无可显示的类型）"]
    return (
      <box flexDirection="column">
        <text fg={theme().accent}>{"Studio · 浏览类型 › " + (e?.name ?? "")}</text>
        <box flexDirection="column" paddingTop={1}>
          <For each={lines}>{(ln) => <text fg={theme().text}>{ln.length > 0 ? ln : " "}</text>}</For>
        </box>
        <box flexDirection="column" paddingTop={1}>
          <text fg={theme().textMuted}>Esc 返回类型列表</text>
        </box>
      </box>
    )
  }

  function renderConfirmDelete(s: StudioShellState): JSX.Element {
    const e = s.selected
    return (
      <box flexDirection="column">
        <text fg={theme().accent}>Studio · 删除类型</text>
        <box flexDirection="column" paddingTop={1}>
          <text fg={theme().text}>{`⚠ 确认删除自定义 workflow「${e?.name ?? ""}」的源文件？`}</text>
          <text fg={theme().textMuted}>{e?.path ?? ""}</text>
          <text fg={theme().textMuted}>删除的是 workflow 类型定义（不影响任何已存在的运行记录与产物），不可撤销。</text>
        </box>
        <box flexDirection="column" paddingTop={1}>
          <text fg={theme().textMuted}>Enter 确认删除   Esc 取消</text>
        </box>
      </box>
    )
  }
}
