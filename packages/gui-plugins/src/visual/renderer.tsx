import { createSignal, onMount, Show } from "solid-js"
import {
  CodeBlock,
  Command,
  ComposerPill,
  MenuItem,
  Panel,
  Style,
  type MountedSession,
  type PanelTab,
  type Plugin,
} from "@opencode/plugin/gui"
import type Visual from "./index"
import visualCSS from "./core/visual.css?inline"
import workbenchCSS from "./core/workbench.css?inline"
import { parseVisual } from "./core/spec"
import { VisualView, visualID } from "./core/view"
import { Workbench, type VisualEntry } from "./core/workbench"

const TAB = "workbench"

const LIMIT = 30

const setup: Plugin.Setup<typeof Visual> = (ctx) => {
  const key = `${ctx.id}:${TAB}`
  const [library, setLibrary] = createSignal<Record<string, readonly VisualEntry[]>>({})

  const entries = (sessionKey: string): readonly VisualEntry[] => library()[sessionKey] ?? []

  const remember = (sessionKey: string, code: string) => {
    const parsed = parseVisual(code)

    if (!parsed.ok) return

    const id = visualID(code)

    setLibrary((current) => {
      const existing = current[sessionKey] ?? []

      if (existing.some((entry) => entry.id === id)) return current

      const live = new Set(ctx.sessions.list().map((session) => session.key))
      live.add(sessionKey)
      live.add("local")

      const next: Record<string, readonly VisualEntry[]> = {}

      for (const [key, entries] of Object.entries(current)) {
        if (live.has(key)) next[key] = entries
      }

      next[sessionKey] = [...existing, { id, code, spec: parsed.spec }].slice(-LIMIT)

      return next
    })
  }

  const loaded = new Set<string>()

  const load = async (session: NonNullable<ReturnType<typeof ctx.sessions.current>>) => {
    if (loaded.has(session.key)) return
    loaded.add(session.key)

    const client = ctx.servers.get(session.server.id)?.client

    if (!client) return

    try {
      const result = await client.message.list({ sessionID: session.id, limit: 200 })

      for (const message of result.data) {
        const content = "content" in message && Array.isArray(message.content) ? message.content : []

        for (const part of content) {
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- session message content is decoded untrusted JSON; verify the text part before reading it.
          if (part.type !== "text" || typeof part.text !== "string") continue

          for (const match of part.text.matchAll(/```(?:visual|genui)\s*\n([\s\S]*?)```/g)) {
            if (match[1]) remember(session.key, match[1])
          }
        }
      }
    } catch {
      loaded.delete(session.key)
    }
  }

  const opened = new Set<string>()

  const open = (session = ctx.sessions.current(), once = false) => {
    if (!session) return

    if (once && opened.has(session.key)) return

    opened.add(session.key)

    if (ctx.layout.narrow()) ctx.layout.open(key, session)
    else ctx.layout.open(key, session, { tab: "select" })
  }

  const VisualBlock = (props: {
    code: string
    title: string
    kind: string
    session?: MountedSession
  }) => {
    onMount(() => {
      if (!props.session) return

      remember(props.session.key, props.code)

      if (ctx.appearance.visualDisplay() === "panel") queueMicrotask(() => open(props.session, true))
    })

    return (
      <Show
        when={ctx.appearance.visualDisplay() === "inline"}
        fallback={
          <button type="button" class="vz-open" onClick={() => open(props.session)}>
            <span class="vz-open-kind">{props.kind}</span>
            <span class="vz-open-title">{props.title}</span>
            <span class="vz-open-action">Open in panel</span>
          </button>
        }
      >
        <div class="vz-inline">
          <VisualView code={props.code} context="inline" />
        </div>
      </Show>
    )
  }

  const TabLabel = (props: { sessionKey: string }) => {
    const count = () => entries(props.sessionKey).length

    return (
      <span>
        {ctx.t("title")}
        <Show when={count() > 0}>
          <span style={{ color: "var(--text-weak)", "font-family": "var(--font-family-mono)", "font-size": "11px", "margin-left": "5px" }}>
            {count()}
          </span>
        </Show>
      </span>
    )
  }

  const tab: PanelTab = {
    id: TAB,
    get title() {
      return ctx.t("title")
    },
    label: (state) => <TabLabel sessionKey={state.session.key} />,
  }

  ctx.add(Style, visualCSS)
  ctx.add(Style, workbenchCSS)

  ctx.add(CodeBlock, {
    languages: ["visual", "genui"],
    render: (props) => {
      const parsed = parseVisual(props.code)

      if (!parsed.ok) return undefined

      return (
        <VisualBlock
          code={props.code}
          title={parsed.spec.title}
          kind={parsed.spec.kind}
          session={props.session}
        />
      )
    },
  })

  ctx.add(Panel, {
    id: TAB,
    region: "side",
    width: 520,
    mobile: {
      get title() {
        return ctx.t("title")
      },
      order: 42,
      kind: "tab",
      icon: "outline-eye",
    },
    list: (input) => (input.open.includes(TAB) ? [tab] : []),
    render: (props) => {
      void load(props.session)

      return (
        <Workbench
          entries={entries(props.session.key)}
          sessionKey={props.session.key}
          onCopy={(text) => void ctx.system.copy(text).catch(() => undefined)}
        />
      )
    },
  })

  ctx.add(Command, () => ({
    id: "open",
    get title() {
      return ctx.t("open")
    },
    get enabled() {
      return !!ctx.sessions.current()
    },
    section: "session" as const,
    run: () => open(),
  }))

  ctx.add(MenuItem, {
    menu: "session.panel",
    id: "open",
    get title() {
      return ctx.t("open")
    },
    icon: "outline-eye",
    get description() {
      return ctx.t("description")
    },
    run: () => open(),
  })

  ctx.add(ComposerPill, {
    id: "visuals",
    order: 20,
    show: (input) => {
      const count = entries(input.session.key).length

      if (count === 0) return undefined

      return {
        label: ctx.plural("visuals", count),
        title: ctx.t("open"),
        icon: "outline-eye",
        run: () => open(input.session),
      }
    },
  })
}

export default setup
