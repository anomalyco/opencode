import type { MarkdownCodeBlock, MarkdownCodeBlockMatch } from "../context/markdown"

/** A complete block as plugin content or actions received it; another key means the content must mount again. */
export type CodeBlockKey = {
  readonly match: MarkdownCodeBlockMatch
  readonly language: string
  readonly source: string
}

/** What a Mermaid render draws: whole lines while the block streams, the full source once it is complete. */
export type MermaidInput = { readonly input: string; readonly complete: boolean }

export type MermaidRender = MermaidInput & { readonly attempt: number }

type Shared = {
  /** Started renders and plugin mounts. A result whose attempt is not the current one is stale. */
  readonly attempts: number
  readonly actions?: CodeBlockKey
  /** Plugin content that declined or failed for this exact block, so the block keeps its code until it changes. */
  readonly declined?: CodeBlockKey
}

/**
 * One fenced code block. `code` shows the highlighted source, `diagram-pending` the empty diagram box until the first
 * Mermaid render lands, `diagram` the last good SVG, and `plugin` content a plugin mounted for the block's language.
 * `render` is the Mermaid render in flight; `tried` is the input of the last one that settled, so the same input never
 * renders twice.
 */
export type CodeDecorationState =
  | (Shared & { readonly status: "code"; readonly render?: MermaidRender; readonly tried?: MermaidInput })
  | (Shared & { readonly status: "diagram-pending"; readonly render?: MermaidRender })
  | (Shared & {
      readonly status: "diagram"
      readonly svg: string
      readonly render?: MermaidRender
      readonly tried: MermaidInput
    })
  | (Shared & { readonly status: "plugin"; readonly plugin: CodeBlockKey })

export type CodeDecorationEvent =
  | {
      readonly type: "sync"
      readonly language: string
      readonly source: string
      readonly complete: boolean
      readonly match: MarkdownCodeBlockMatch | undefined
    }
  | { readonly type: "mermaid.resolved"; readonly attempt: number; readonly svg: string | undefined }
  | { readonly type: "mermaid.failed"; readonly attempt: number }
  | { readonly type: "plugin.failed"; readonly attempt: number }
  | { readonly type: "disposed" }

export type CodeDecorationEffect =
  | { readonly type: "clear-actions" }
  | { readonly type: "clear-plugin" }
  | { readonly type: "mount-actions"; readonly block: MarkdownCodeBlock }
  | { readonly type: "mount-plugin"; readonly attempt: number; readonly block: MarkdownCodeBlock }
  | { readonly type: "render-mermaid"; readonly attempt: number; readonly input: string }

export type CodeDecorationTransition = {
  readonly state: CodeDecorationState
  readonly effects: readonly CodeDecorationEffect[]
}

type Sync = Extract<CodeDecorationEvent, { type: "sync" }>

export const INITIAL_CODE_DECORATION_STATE: CodeDecorationState = Object.freeze({ status: "code", attempts: 0 })

export const EMPTY_CODE_EFFECTS: readonly CodeDecorationEffect[] = Object.freeze([])

export function transitionCodeDecoration(
  state: CodeDecorationState,
  event: CodeDecorationEvent,
): CodeDecorationTransition {
  if (event.type === "sync") return settle(state, sync(state, event, state.declined))

  if (event.type === "plugin.failed") {
    if (state.status !== "plugin" || event.attempt !== state.attempts) return { state, effects: EMPTY_CODE_EFFECTS }
    const plugin = state.plugin

    return settle(state, sync(state, { type: "sync", ...plugin, complete: true }, plugin))
  }

  if (event.type === "disposed") return settle(state, { status: "code", attempts: state.attempts })

  if (state.status === "plugin" || state.render?.attempt !== event.attempt)
    return { state, effects: EMPTY_CODE_EFFECTS }
  const render = state.render
  const shared = { attempts: state.attempts, actions: state.actions, declined: state.declined }

  if (event.type === "mermaid.resolved" && event.svg)
    return settle(state, { ...shared, status: "diagram", svg: event.svg, tried: render })

  // A partial diagram often fails until more lines arrive, so the last good one stays; a complete failure shows the code.
  if (state.status === "diagram" && !render.complete)
    return settle(state, { ...shared, status: "diagram", svg: state.svg, tried: render })

  return settle(state, { ...shared, status: "code", tried: render })
}

export function viewCodeDecoration(state: CodeDecorationState) {
  return {
    diagram: state.status === "diagram-pending" || state.status === "diagram",
    pending: state.status === "diagram-pending",
    svg: state.status === "diagram" ? state.svg : undefined,
    content: state.status === "plugin",
  }
}

function sync(state: CodeDecorationState, event: Sync, declined: CodeBlockKey | undefined): CodeDecorationState {
  const match = event.match
  const claimed = !!match?.render.has(event.language)
  const failed = declined && sameBlock(declined, event) ? declined : undefined

  const actions =
    !match || !event.complete || !match.actions.has(event.language)
      ? undefined
      : state.actions && sameBlock(state.actions, event)
        ? state.actions
        : { match, language: event.language, source: event.source }

  if (match && claimed && event.complete && !failed) {
    if (state.status === "plugin" && sameBlock(state.plugin, event)) return keep(state, actions, failed)

    return {
      status: "plugin",
      attempts: state.attempts + 1,
      plugin: { match, language: event.language, source: event.source },
      actions,
    }
  }

  // Claimed content waits for the closing fence and gets the code until then, not the built-in diagram.
  if (event.language !== "mermaid" || !event.source || (claimed && !failed)) {
    if (state.status === "code" && !state.render && !state.tried) return keep(state, actions, failed)

    return { status: "code", attempts: state.attempts, actions, declined: failed }
  }

  const input = event.complete ? event.source : event.source.slice(0, event.source.lastIndexOf("\n") + 1)

  if (state.status === "plugin" || (state.status === "code" && !state.render && !state.tried)) {
    if (!input) return { status: "diagram-pending", attempts: state.attempts, actions, declined: failed }
    const attempt = state.attempts + 1

    return {
      status: "diagram-pending",
      attempts: attempt,
      render: { attempt, input, complete: event.complete },
      actions,
      declined: failed,
    }
  }

  const latest = state.render ?? (state.status === "diagram-pending" ? undefined : state.tried)

  if (!input || (latest?.input === input && latest.complete === event.complete)) return keep(state, actions, failed)
  const render = { attempt: state.attempts + 1, input, complete: event.complete }

  return { ...state, attempts: render.attempt, render, actions, declined: failed }
}

function keep(state: CodeDecorationState, actions: CodeBlockKey | undefined, declined: CodeBlockKey | undefined) {
  if (state.actions === actions && state.declined === declined) return state

  return { ...state, actions, declined }
}

// Effects follow from the difference between the two states, so every transition mounts and clears the same way.
function settle(state: CodeDecorationState, next: CodeDecorationState): CodeDecorationTransition {
  if (next === state) return { state, effects: EMPTY_CODE_EFFECTS }
  const plugin = state.status === "plugin" ? state.attempts : undefined
  const nextPlugin = next.status === "plugin" ? next : undefined
  const render = state.status === "plugin" ? undefined : state.render
  const nextRender = next.status === "plugin" ? undefined : next.render

  const effects: CodeDecorationEffect[] = [
    ...(state.actions && state.actions !== next.actions ? [{ type: "clear-actions" as const }] : []),
    ...(plugin !== undefined && plugin !== nextPlugin?.attempts ? [{ type: "clear-plugin" as const }] : []),
    ...(next.actions && next.actions !== state.actions
      ? [{ type: "mount-actions" as const, block: block(next.actions) }]
      : []),
    ...(nextPlugin && nextPlugin.attempts !== plugin
      ? [{ type: "mount-plugin" as const, attempt: nextPlugin.attempts, block: block(nextPlugin.plugin) }]
      : []),
    ...(nextRender && nextRender !== render
      ? [{ type: "render-mermaid" as const, attempt: nextRender.attempt, input: nextRender.input }]
      : []),
  ]

  return { state: next, effects }
}

function block(key: CodeBlockKey): MarkdownCodeBlock {
  return { code: key.source.replace(/\n$/, ""), language: key.language }
}

function sameBlock(key: CodeBlockKey, event: Pick<Sync, "match" | "language" | "source">) {
  return key.match === event.match && key.language === event.language && key.source === event.source
}
