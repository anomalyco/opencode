/** @jsxImportSource @opentui/solid */
import { useKeyboard, useTerminalDimensions, type JSX } from "@opentui/solid"
import { RGBA, VignetteEffect } from "@opentui/core"
import type {
  TuiKeybindSet,
  TuiPlugin,
  TuiPluginApi,
  TuiPluginMeta,
  TuiPluginModule,
  TuiSlotPlugin,
} from "@opencode-ai/plugin/tui"

const tabs = ["overview", "counter", "help"]
const bind = {
  modal: "ctrl+shift+m",
  screen: "ctrl+shift+o",
  home: "escape,ctrl+h",
  left: "left,h",
  right: "right,l",
  up: "up,k",
  down: "down,j",
  alert: "a",
  confirm: "c",
  prompt: "p",
  select: "s",
  modal_accept: "enter,return",
  modal_close: "escape",
  dialog_close: "escape",
  local: "x",
  local_push: "enter,return",
  local_close: "q,backspace",
  host: "z",
}

const pick = (value: unknown, fallback: string) => {
  if (typeof value !== "string") return fallback
  if (!value.trim()) return fallback
  return value
}

const num = (value: unknown, fallback: number) => {
  if (typeof value !== "number") return fallback
  return value
}

const rec = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return Object.fromEntries(Object.entries(value))
}

type Cfg = {
  label: string
  route: string
  vignette: number
  keybinds: Record<string, unknown> | undefined
}

type Route = {
  modal: string
  screen: string
}

type State = {
  tab: number
  count: number
  source: string
  note: string
  selected: string
  local: number
}

const cfg = (options: Record<string, unknown> | undefined) => {
  return {
    label: pick(options?.label, "smoke"),
    route: pick(options?.route, "workspace-smoke"),
    vignette: Math.max(0, num(options?.vignette, 0.35)),
    keybinds: rec(options?.keybinds),
  }
}

const names = (input: Cfg) => {
  return {
    modal: `${input.route}.modal`,
    screen: `${input.route}.screen`,
  }
}

type Keys = TuiKeybindSet
const ui = {
  panel: "#1d1d1d",
  border: "#4a4a4a",
  text: "#f0f0f0",
  muted: "#a5a5a5",
  accent: "#5f87ff",
}

type Color = RGBA | string

const ink = (map: Record<string, unknown>, name: string, fallback: string): Color => {
  const value = map[name]
  if (typeof value === "string") return value
  if (value instanceof RGBA) return value
  return fallback
}

const look = (map: Record<string, unknown>) => {
  return {
    panel: ink(map, "backgroundPanel", ui.panel),
    border: ink(map, "border", ui.border),
    text: ink(map, "text", ui.text),
    muted: ink(map, "textMuted", ui.muted),
    accent: ink(map, "primary", ui.accent),
    selected: ink(map, "selectedListItemText", ui.text),
  }
}

const tone = (api: TuiPluginApi) => {
  return look(api.theme.current)
}

type Skin = {
  panel: Color
  border: Color
  text: Color
  muted: Color
  accent: Color
  selected: Color
}

const Btn = (props: { txt: string; run: () => void; skin: Skin; on?: boolean }) => {
  return (
    <box
      onMouseUp={() => {
        props.run()
      }}
      backgroundColor={props.on ? props.skin.accent : props.skin.border}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={props.on ? props.skin.selected : props.skin.text}>{props.txt}</text>
    </box>
  )
}

const parse = (params: Record<string, unknown> | undefined) => {
  const tab = typeof params?.tab === "number" ? params.tab : 0
  const count = typeof params?.count === "number" ? params.count : 0
  const source = typeof params?.source === "string" ? params.source : "unknown"
  const note = typeof params?.note === "string" ? params.note : ""
  const selected = typeof params?.selected === "string" ? params.selected : ""
  const local = typeof params?.local === "number" ? params.local : 0
  return {
    tab: Math.max(0, Math.min(tab, tabs.length - 1)),
    count,
    source,
    note,
    selected,
    local: Math.max(0, local),
  }
}

const current = (api: TuiPluginApi, route: Route) => {
  const value = api.route.current
  const ok = Object.values(route).includes(value.name)
  if (!ok) return parse(undefined)
  if (!("params" in value)) return parse(undefined)
  return parse(value.params)
}

const opts = [
  {
    title: "Overview",
    value: 0,
    description: "Switch to overview tab",
  },
  {
    title: "Counter",
    value: 1,
    description: "Switch to counter tab",
  },
  {
    title: "Help",
    value: 2,
    description: "Switch to help tab",
  },
]

const host = (api: TuiPluginApi, input: Cfg, skin: Skin) => {
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <box paddingBottom={1} paddingLeft={2} paddingRight={2} gap={1} flexDirection="column">
      <text fg={skin.text}>
        <b>{input.label} host overlay</b>
      </text>
      <text fg={skin.muted}>Using api.ui.dialog stack with built-in backdrop</text>
      <text fg={skin.muted}>esc closes · depth {api.ui.dialog.depth}</text>
      <box flexDirection="row" gap={1}>
        <Btn txt="close" run={() => api.ui.dialog.clear()} skin={skin} on />
      </box>
    </box>
  ))
}

const warn = (api: TuiPluginApi, route: Route, value: State) => {
  const DialogAlert = api.ui.DialogAlert
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogAlert
      title="Smoke alert"
      message="Testing built-in alert dialog"
      onConfirm={() => api.route.navigate(route.screen, { ...value, source: "alert" })}
    />
  ))
}

const check = (api: TuiPluginApi, route: Route, value: State) => {
  const DialogConfirm = api.ui.DialogConfirm
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogConfirm
      title="Smoke confirm"
      message="Apply +1 to counter?"
      onConfirm={() => api.route.navigate(route.screen, { ...value, count: value.count + 1, source: "confirm" })}
      onCancel={() => api.route.navigate(route.screen, { ...value, source: "confirm-cancel" })}
    />
  ))
}

const entry = (api: TuiPluginApi, route: Route, value: State) => {
  const DialogPrompt = api.ui.DialogPrompt
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogPrompt
      title="Smoke prompt"
      value={value.note}
      onConfirm={(note) => {
        api.ui.dialog.clear()
        api.route.navigate(route.screen, { ...value, note, source: "prompt" })
      }}
      onCancel={() => {
        api.ui.dialog.clear()
        api.route.navigate(route.screen, value)
      }}
    />
  ))
}

const picker = (api: TuiPluginApi, route: Route, value: State) => {
  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title="Smoke select"
      options={opts}
      current={value.tab}
      onSelect={(item) => {
        api.ui.dialog.clear()
        api.route.navigate(route.screen, {
          ...value,
          tab: typeof item.value === "number" ? item.value : value.tab,
          selected: item.title,
          source: "select",
        })
      }}
    />
  ))
}

const Screen = (props: {
  api: TuiPluginApi
  input: Cfg
  route: Route
  keys: Keys
  meta: TuiPluginMeta
  params?: Record<string, unknown>
}) => {
  const dim = useTerminalDimensions()
  const value = parse(props.params)
  const skin = tone(props.api)
  const set = (local: number, base?: State) => {
    const next = base ?? current(props.api, props.route)
    props.api.route.navigate(props.route.screen, { ...next, local: Math.max(0, local), source: "local" })
  }
  const push = (base?: State) => {
    const next = base ?? current(props.api, props.route)
    set(next.local + 1, next)
  }
  const open = () => {
    const next = current(props.api, props.route)
    if (next.local > 0) return
    set(1, next)
  }
  const pop = (base?: State) => {
    const next = base ?? current(props.api, props.route)
    const local = Math.max(0, next.local - 1)
    set(local, next)
  }
  const show = () => {
    setTimeout(() => {
      open()
    }, 0)
  }
  useKeyboard((evt) => {
    if (props.api.route.current.name !== props.route.screen) return
    const next = current(props.api, props.route)
    if (props.api.ui.dialog.open) {
      if (props.keys.match("dialog_close", evt)) {
        evt.preventDefault()
        evt.stopPropagation()
        props.api.ui.dialog.clear()
        return
      }
      return
    }

    if (next.local > 0) {
      if (evt.name === "escape" || props.keys.match("local_close", evt)) {
        evt.preventDefault()
        evt.stopPropagation()
        pop(next)
        return
      }

      if (props.keys.match("local_push", evt)) {
        evt.preventDefault()
        evt.stopPropagation()
        push(next)
        return
      }
      return
    }

    if (props.keys.match("home", evt)) {
      evt.preventDefault()
      evt.stopPropagation()
      props.api.route.navigate("home")
      return
    }

    if (props.keys.match("left", evt)) {
      evt.preventDefault()
      evt.stopPropagation()
      props.api.route.navigate(props.route.screen, { ...next, tab: (next.tab - 1 + tabs.length) % tabs.length })
      return
    }

    if (props.keys.match("right", evt)) {
      evt.preventDefault()
      evt.stopPropagation()
      props.api.route.navigate(props.route.screen, { ...next, tab: (next.tab + 1) % tabs.length })
      return
    }

    if (props.keys.match("up", evt)) {
      evt.preventDefault()
      evt.stopPropagation()
      props.api.route.navigate(props.route.screen, { ...next, count: next.count + 1 })
      return
    }

    if (props.keys.match("down", evt)) {
      evt.preventDefault()
      evt.stopPropagation()
      props.api.route.navigate(props.route.screen, { ...next, count: next.count - 1 })
      return
    }

    if (props.keys.match("modal", evt)) {
      evt.preventDefault()
      evt.stopPropagation()
      props.api.route.navigate(props.route.modal, next)
      return
    }

    if (props.keys.match("local", evt)) {
      evt.preventDefault()
      evt.stopPropagation()
      open()
      return
    }

    if (props.keys.match("host", evt)) {
      evt.preventDefault()
      evt.stopPropagation()
      host(props.api, props.input, skin)
      return
    }

    if (props.keys.match("alert", evt)) {
      evt.preventDefault()
      evt.stopPropagation()
      warn(props.api, props.route, next)
      return
    }

    if (props.keys.match("confirm", evt)) {
      evt.preventDefault()
      evt.stopPropagation()
      check(props.api, props.route, next)
      return
    }

    if (props.keys.match("prompt", evt)) {
      evt.preventDefault()
      evt.stopPropagation()
      entry(props.api, props.route, next)
      return
    }

    if (props.keys.match("select", evt)) {
      evt.preventDefault()
      evt.stopPropagation()
      picker(props.api, props.route, next)
    }
  })

  return (
    <box width={dim().width} height={dim().height} backgroundColor={skin.panel} position="relative">
      <box
        flexDirection="column"
        width="100%"
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
      >
        <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
          <text fg={skin.text}>
            <b>{props.input.label} screen</b>
            <span style={{ fg: skin.muted }}> plugin route</span>
          </text>
          <text fg={skin.muted}>{props.keys.print("home")} home</text>
        </box>

        <box flexDirection="row" gap={1} paddingBottom={1}>
          {tabs.map((item, i) => {
            const on = value.tab === i
            return (
              <Btn
                txt={item}
                run={() => props.api.route.navigate(props.route.screen, { ...value, tab: i })}
                skin={skin}
                on={on}
              />
            )
          })}
        </box>

        <box
          border
          borderColor={skin.border}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexGrow={1}
        >
          {value.tab === 0 ? (
            <box flexDirection="column" gap={1}>
              <text fg={skin.text}>Route: {props.route.screen}</text>
              <text fg={skin.muted}>plugin state: {props.meta.state}</text>
              <text fg={skin.muted}>
                first: {props.meta.state === "first" ? "yes" : "no"} · updated:{" "}
                {props.meta.state === "updated" ? "yes" : "no"} · loads: {props.meta.load_count}
              </text>
              <text fg={skin.muted}>plugin source: {props.meta.source}</text>
              <text fg={skin.muted}>source: {value.source}</text>
              <text fg={skin.muted}>note: {value.note || "(none)"}</text>
              <text fg={skin.muted}>selected: {value.selected || "(none)"}</text>
              <text fg={skin.muted}>local stack depth: {value.local}</text>
              <text fg={skin.muted}>host stack open: {props.api.ui.dialog.open ? "yes" : "no"}</text>
            </box>
          ) : null}

          {value.tab === 1 ? (
            <box flexDirection="column" gap={1}>
              <text fg={skin.text}>Counter: {value.count}</text>
              <text fg={skin.muted}>
                {props.keys.print("up")} / {props.keys.print("down")} change value
              </text>
            </box>
          ) : null}

          {value.tab === 2 ? (
            <box flexDirection="column" gap={1}>
              <text fg={skin.muted}>
                {props.keys.print("modal")} modal | {props.keys.print("alert")} alert | {props.keys.print("confirm")}{" "}
                confirm | {props.keys.print("prompt")} prompt | {props.keys.print("select")} select
              </text>
              <text fg={skin.muted}>
                {props.keys.print("local")} local stack | {props.keys.print("host")} host stack
              </text>
              <text fg={skin.muted}>
                local open: {props.keys.print("local_push")} push nested · esc or {props.keys.print("local_close")}{" "}
                close
              </text>
              <text fg={skin.muted}>{props.keys.print("home")} returns home</text>
            </box>
          ) : null}
        </box>

        <box flexDirection="row" gap={1} paddingTop={1}>
          <Btn txt="go home" run={() => props.api.route.navigate("home")} skin={skin} />
          <Btn txt="modal" run={() => props.api.route.navigate(props.route.modal, value)} skin={skin} on />
          <Btn txt="local overlay" run={show} skin={skin} />
          <Btn txt="host overlay" run={() => host(props.api, props.input, skin)} skin={skin} />
          <Btn txt="alert" run={() => warn(props.api, props.route, value)} skin={skin} />
          <Btn txt="confirm" run={() => check(props.api, props.route, value)} skin={skin} />
          <Btn txt="prompt" run={() => entry(props.api, props.route, value)} skin={skin} />
          <Btn txt="select" run={() => picker(props.api, props.route, value)} skin={skin} />
        </box>
      </box>

      <box
        visible={value.local > 0}
        width={dim().width}
        height={dim().height}
        alignItems="center"
        position="absolute"
        zIndex={3000}
        paddingTop={dim().height / 4}
        left={0}
        top={0}
        backgroundColor={RGBA.fromInts(0, 0, 0, 160)}
        onMouseUp={() => {
          pop()
        }}
      >
        <box
          onMouseUp={(evt) => {
            evt.stopPropagation()
          }}
          width={60}
          maxWidth={dim().width - 2}
          backgroundColor={skin.panel}
          border
          borderColor={skin.border}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          gap={1}
          flexDirection="column"
        >
          <text fg={skin.text}>
            <b>{props.input.label} local overlay</b>
          </text>
          <text fg={skin.muted}>Plugin-owned stack depth: {value.local}</text>
          <text fg={skin.muted}>
            {props.keys.print("local_push")} push nested · {props.keys.print("local_close")} pop/close
          </text>
          <box flexDirection="row" gap={1}>
            <Btn txt="push" run={push} skin={skin} on />
            <Btn txt="pop" run={pop} skin={skin} />
          </box>
        </box>
      </box>
    </box>
  )
}

const Modal = (props: {
  api: TuiPluginApi
  input: Cfg
  route: Route
  keys: Keys
  params?: Record<string, unknown>
}) => {
  const Dialog = props.api.ui.Dialog
  const value = parse(props.params)
  const skin = tone(props.api)

  useKeyboard((evt) => {
    if (props.api.route.current.name !== props.route.modal) return

    if (props.keys.match("modal_accept", evt)) {
      evt.preventDefault()
      evt.stopPropagation()
      props.api.route.navigate(props.route.screen, { ...value, source: "modal" })
      return
    }

    if (props.keys.match("modal_close", evt)) {
      evt.preventDefault()
      evt.stopPropagation()
      props.api.route.navigate("home")
    }
  })

  return (
    <box width="100%" height="100%" backgroundColor={skin.panel}>
      <Dialog onClose={() => props.api.route.navigate("home")}>
        <box paddingBottom={1} paddingLeft={2} paddingRight={2} gap={1} flexDirection="column">
          <text fg={skin.text}>
            <b>{props.input.label} modal</b>
          </text>
          <text fg={skin.muted}>{props.keys.print("modal")} modal command</text>
          <text fg={skin.muted}>{props.keys.print("screen")} screen command</text>
          <text fg={skin.muted}>
            {props.keys.print("modal_accept")} opens screen · {props.keys.print("modal_close")} closes
          </text>
          <box flexDirection="row" gap={1}>
            <Btn
              txt="open screen"
              run={() => props.api.route.navigate(props.route.screen, { ...value, source: "modal" })}
              skin={skin}
              on
            />
            <Btn txt="cancel" run={() => props.api.route.navigate("home")} skin={skin} />
          </box>
        </box>
      </Dialog>
    </box>
  )
}

const home = (api: TuiPluginApi, input: Cfg) => ({
  slots: {
    home_logo(ctx) {
      const map = ctx.theme.current
      const skin = look(map)
      const art = [
        "                                  $$\\",
        "                                  $$ |",
        " $$$$$$$\\ $$$$$$\\$$$$\\   $$$$$$\\  $$ |  $$\\  $$$$$$\\",
        "$$  _____|$$  _$$  _$$\\ $$  __$$\\ $$ | $$  |$$  __$$\\",
        "\\$$$$$$\\  $$ / $$ / $$ |$$ /  $$ |$$$$$$  / $$$$$$$$ |",
        " \\____$$\\ $$ | $$ | $$ |$$ |  $$ |$$  _$$<  $$   ____|",
        "$$$$$$$  |$$ | $$ | $$ |\\$$$$$$  |$$ | \\$$\\ \\$$$$$$$\\",
        "\\_______/ \\__| \\__| \\__| \\______/ \\__|  \\__| \\_______|",
      ]
      const fill = [
        skin.accent,
        skin.muted,
        ink(map, "info", ui.accent),
        skin.text,
        ink(map, "success", ui.accent),
        ink(map, "warning", ui.accent),
        ink(map, "secondary", ui.accent),
        ink(map, "error", ui.accent),
      ]

      return (
        <box flexDirection="column">
          {art.map((line, i) => (
            <text fg={fill[i]}>{line}</text>
          ))}
        </box>
      )
    },
    home_prompt(ctx, value) {
      const skin = look(ctx.theme.current)
      type Prompt = (props: {
        workspaceID?: string
        visible?: boolean
        disabled?: boolean
        onSubmit?: () => void
        hint?: JSX.Element
        right?: JSX.Element
        showPlaceholder?: boolean
        placeholders?: {
          normal?: string[]
          shell?: string[]
        }
      }) => JSX.Element
      type Slot = (
        props: { name: string; mode?: unknown; children?: JSX.Element } & Record<string, unknown>,
      ) => JSX.Element | null
      const ui = api.ui as TuiPluginApi["ui"] & { Prompt: Prompt; Slot: Slot }
      const Prompt = ui.Prompt
      const Slot = ui.Slot
      const normal = [
        `[SMOKE] route check for ${input.label}`,
        "[SMOKE] confirm home_prompt slot override",
        "[SMOKE] verify prompt-right slot passthrough",
      ]
      const shell = ["printf '[SMOKE] home prompt\n'", "git status --short", "bun --version"]
      const hint = (
        <box flexShrink={0} flexDirection="row" gap={1}>
          <text fg={skin.muted}>
            <span style={{ fg: skin.accent }}>•</span> smoke home prompt
          </text>
        </box>
      )

      return (
        <Prompt
          workspaceID={value.workspace_id}
          hint={hint}
          right={
            <box flexDirection="row" gap={1}>
              <Slot name="home_prompt_right" workspace_id={value.workspace_id} />
              <Slot name="smoke_prompt_right" workspace_id={value.workspace_id} label={input.label} />
            </box>
          }
          placeholders={{ normal, shell }}
        />
      )
    },
    home_prompt_right(ctx, value) {
      const skin = look(ctx.theme.current)
      const id = value.workspace_id?.slice(0, 8) ?? "none"
      return (
        <text fg={skin.muted}>
          <span style={{ fg: skin.accent }}>{input.label}</span> home:{id}
        </text>
      )
    },
    session_prompt_right(ctx, value) {
      const skin = look(ctx.theme.current)
      return (
        <text fg={skin.muted}>
          <span style={{ fg: skin.accent }}>{input.label}</span> session:{value.session_id.slice(0, 8)}
        </text>
      )
    },
    smoke_prompt_right(ctx, value) {
      const skin = look(ctx.theme.current)
      const id = typeof value.workspace_id === "string" ? value.workspace_id.slice(0, 8) : "none"
      const label = typeof value.label === "string" ? value.label : input.label
      return (
        <text fg={skin.muted}>
          <span style={{ fg: skin.accent }}>{label}</span> custom:{id}
        </text>
      )
    },
    home_bottom(ctx) {
      const skin = look(ctx.theme.current)
      const text = "extra content in the unified home bottom slot"

      return (
        <box width="100%" maxWidth={75} alignItems="center" paddingTop={1} flexShrink={0} gap={1}>
          <box
            border
            borderColor={skin.border}
            backgroundColor={skin.panel}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
            width="100%"
          >
            <text fg={skin.muted}>
              <span style={{ fg: skin.accent }}>{input.label}</span> {text}
            </text>
          </box>
        </box>
      )
    },
  },
})

const block = (input: Cfg, order: number, title: string, text: string): TuiSlotPlugin => ({
  order,
  slots: {
    sidebar_content(ctx, value) {
      const skin = look(ctx.theme.current)

      return (
        <box
          border
          borderColor={skin.border}
          backgroundColor={skin.panel}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="column"
          gap={1}
        >
          <text fg={skin.accent}>
            <b>{title}</b>
          </text>
          <text fg={skin.text}>{text}</text>
          <text fg={skin.muted}>
            {input.label} order {order} · session {value.session_id.slice(0, 8)}
          </text>
        </box>
      )
    },
  },
})

const slot = (api: TuiPluginApi, input: Cfg): TuiSlotPlugin[] => [
  home(api, input),
  block(input, 50, "Smoke above", "renders above internal sidebar blocks"),
  block(input, 250, "Smoke between", "renders between internal sidebar blocks"),
  block(input, 650, "Smoke below", "renders below internal sidebar blocks"),
]

const reg = (api: TuiPluginApi, input: Cfg, keys: Keys) => {
  const route = names(input)
  api.command.register(() => [
    {
      title: `${input.label} modal`,
      value: "plugin.smoke.modal",
      keybind: keys.get("modal"),
      category: "Plugin",
      slash: {
        name: "smoke",
      },
      onSelect: () => {
        api.route.navigate(route.modal, { source: "command" })
      },
    },
    {
      title: `${input.label} screen`,
      value: "plugin.smoke.screen",
      keybind: keys.get("screen"),
      category: "Plugin",
      slash: {
        name: "smoke-screen",
      },
      onSelect: () => {
        api.route.navigate(route.screen, { source: "command", tab: 0, count: 0 })
      },
    },
    {
      title: `${input.label} alert dialog`,
      value: "plugin.smoke.alert",
      category: "Plugin",
      slash: {
        name: "smoke-alert",
      },
      onSelect: () => {
        warn(api, route, current(api, route))
      },
    },
    {
      title: `${input.label} confirm dialog`,
      value: "plugin.smoke.confirm",
      category: "Plugin",
      slash: {
        name: "smoke-confirm",
      },
      onSelect: () => {
        check(api, route, current(api, route))
      },
    },
    {
      title: `${input.label} prompt dialog`,
      value: "plugin.smoke.prompt",
      category: "Plugin",
      slash: {
        name: "smoke-prompt",
      },
      onSelect: () => {
        entry(api, route, current(api, route))
      },
    },
    {
      title: `${input.label} select dialog`,
      value: "plugin.smoke.select",
      category: "Plugin",
      slash: {
        name: "smoke-select",
      },
      onSelect: () => {
        picker(api, route, current(api, route))
      },
    },
    {
      title: `${input.label} host overlay`,
      value: "plugin.smoke.host",
      category: "Plugin",
      slash: {
        name: "smoke-host",
      },
      onSelect: () => {
        host(api, input, tone(api))
      },
    },
    {
      title: `${input.label} go home`,
      value: "plugin.smoke.home",
      category: "Plugin",
      enabled: api.route.current.name !== "home",
      onSelect: () => {
        api.route.navigate("home")
      },
    },
    {
      title: `${input.label} toast`,
      value: "plugin.smoke.toast",
      category: "Plugin",
      onSelect: () => {
        api.ui.toast({
          variant: "info",
          title: "Smoke",
          message: "Plugin toast works",
          duration: 2000,
        })
      },
    },
  ])
}

const tui: TuiPlugin = async (api, options, meta) => {
  if (options?.enabled === false) return

  await api.theme.install("./smoke-theme.json")
  api.theme.set("smoke-theme")

  const value = cfg(options ?? undefined)
  const route = names(value)
  const keys = api.keybind.create(bind, value.keybinds)
  const fx = new VignetteEffect(value.vignette)
  const post = fx.apply.bind(fx)
  api.renderer.addPostProcessFn(post)
  api.lifecycle.onDispose(() => {
    api.renderer.removePostProcessFn(post)
  })

  api.route.register([
    {
      name: route.screen,
      render: ({ params }) => <Screen api={api} input={value} route={route} keys={keys} meta={meta} params={params} />,
    },
    {
      name: route.modal,
      render: ({ params }) => <Modal api={api} input={value} route={route} keys={keys} params={params} />,
    },
  ])

  reg(api, value, keys)
  for (const item of slot(api, value)) {
    api.slots.register(item)
  }
}

const plugin: TuiPluginModule & { id: string } = {
  id: "tui-smoke",
  tui,
}

export default plugin
