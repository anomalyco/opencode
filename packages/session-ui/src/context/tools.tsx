import type { JsonValue } from "@opencode/client/promise"
import { createContext, useContext, type JSX, type ParentProps } from "solid-js"

/** A tool call as a host renderer sees it. Every field is a getter over the live call. */
export type ToolCallView = {
  readonly id: string
  readonly name: string
  readonly status: "pending" | "running" | "completed" | "error"
  readonly input: { readonly [key: string]: JsonValue }
  readonly output?: string
  readonly error?: string
  readonly metadata: { readonly [key: string]: JsonValue }
  readonly files: readonly ToolCallFileView[]
}

/** A file in a tool result. `url` resolves a URL an `<img>` can show, or undefined when the bytes are unavailable. */
export type ToolCallFileView = {
  readonly mime: string
  readonly name?: string
  url(signal?: AbortSignal): Promise<string | undefined>
}

/** What the collapsed row shows instead of the default "Called `tool`" trigger. */
export type ToolTriggerView = { readonly title: string; readonly subtitle?: string; readonly args?: readonly string[] }

/** How the host renders one tool that has no built-in renderer. */
export type ToolView = {
  trigger?(tool: ToolCallView): ToolTriggerView | undefined
  render?(tool: ToolCallView): JSX.Element
  /** Renders `children` with the contributor's context. A throw is recorded and renders `fallback` instead. */
  isolate(children: () => JSX.Element, fallback: () => JSX.Element): JSX.Element
}

/** Looks up the view for a tool name. Called once per row whose tool has no built-in renderer. */
export type ToolViews = { match(name: string): ToolView | undefined }

const context = createContext<ToolViews>()

/**
 * Lets the host render tools without a built-in renderer. Without it, those tools use the default row. `value` is
 * inherited when omitted; `false` turns host rendering off below.
 */
export function ToolViewsProvider(props: ParentProps<{ value?: ToolViews | false }>) {
  const parent = useToolViews()

  return (
    <context.Provider
      value={{
        match: (name) => {
          if (props.value === false) return undefined

          return (props.value ?? parent)?.match(name)
        },
      }}
    >
      {props.children}
    </context.Provider>
  )
}

export const useToolViews = () => useContext(context)
