import { Prompt, type PromptRef } from "../component/prompt"
import { batch, createEffect, createMemo, createSignal, Match, onMount, Show, Switch } from "solid-js"
import { RGBA } from "@opentui/core"
import { Logo } from "../component/logo"
import { SessionSidebar } from "../component/session-sidebar"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useRouteData } from "../context/route"
import { usePromptRef } from "../context/prompt"
import { useKV } from "../context/kv.tsx"
import { useLocal } from "../context/local"
import { useEditorContext } from "../context/editor"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { FormPrompt } from "./session/form"
import { Slot } from "../plugin/render"
import { useTerminalDimensions } from "@opentui/solid"
import { useTuiConfig } from "../config"
import { useDialog } from "../ui/dialog"
import { BOLT_BASE_MODE, useBindings } from "../keymap"
import { HomeSessionDestinationProvider } from "./home/session-destination"

let once = false
const placeholder = {
  normal: ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"],
  shell: ["ls -la", "git status", "pwd"],
}

export function Home() {
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const [ref, setRef] = createSignal<PromptRef | undefined>()
  const args = useArgs()
  const local = useLocal()
  const editor = useEditorContext()
  const data = useData()
  const location = useLocation()
  const dimensions = useTerminalDimensions()
  const [logoWidth, setLogoWidth] = createSignal(0)
  // Global MCP elicitations can arrive without a session route, so keep them reachable from Home.
  const currentLocation = () => route.location ?? data.location.default()
  const forms = createMemo(() => data.session.form.list("global", currentLocation()) ?? [])
  let sent = false

  const kv = useKV()
  const dialog = useDialog()
  const [sidebarPref, setSidebarPref] = kv.signal<"auto" | "hide">("home_sidebar", "auto")
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const wide = createMemo(() => dimensions().width > 120)
  const sidebarVisible = createMemo(() => {
    if (sidebarOpen()) return true
    return sidebarPref() === "auto" && wide()
  })
  const toggleSidebar = () => {
    batch(() => {
      const isVisible = sidebarVisible()
      setSidebarPref(() => (isVisible ? "hide" : "auto"))
      // On wide terminals the "auto" preference alone shows the sidebar; only
      // narrow terminals need the transient open signal for the overlay.
      setSidebarOpen(isVisible ? false : !wide())
    })
  }
  // Dismissing the transient overlay must not touch the persisted preference,
  // otherwise the automatic sidebar stops appearing on wide terminals.
  const dismissSidebar = () => setSidebarOpen(false)

  useBindings(() => ({
    commands: [
      {
        namespace: "palette",
        name: "session.sidebar.toggle",
        title: sidebarVisible() ? "Hide sidebar" : "Show sidebar",
        category: "Home",
        slashName: "sidebar",
        run: () => {
          toggleSidebar()
          dialog.clear()
        },
      },
    ],
  }))
  useBindings(() => ({
    mode: BOLT_BASE_MODE,
    bindings: tuiConfig.keybinds.gather("home", ["session.sidebar.toggle"]),
  }))
  useBindings(() => ({
    enabled: sidebarVisible() && !wide(),
    bindings: [
      {
        key: "escape",
        desc: "Close sidebar",
        group: "Home",
        cmd: () => dismissSidebar(),
      },
    ],
  }))

  onMount(() => {
    editor.clearSelection()
  })

  const bind = (r: PromptRef | undefined) => {
    setRef(r)
    promptRef.set(r)
    if (once || !r || route.prompt || !args.prompt) return
    r.set({ text: args.prompt, files: [], agents: [], pasted: [] })
    once = true
  }

  createEffect(() => {
    const composer = ref()
    const prompt = route.prompt
    if (!composer || prompt?.text === undefined) return
    untrack(() => composer.set(prompt))
  })

  // Wait for everything submit needs before auto-submitting --prompt; it runs once.
  createEffect(() => {
    const r = ref()
    if (sent) return
    if (!r) return
    if (!local.model.ready || !local.model.catalogReady) return
    if (!local.agent.current() || !local.model.current()) return
    if (!args.prompt) return
    if (r.current.text !== args.prompt) return
    sent = true
    r.submit()
  })

  return (
    <HomeSessionDestinationProvider>
      <box flexDirection="row" flexGrow={1} minHeight={0}>
        <Show when={sidebarVisible()}>
          <Switch>
            <Match when={wide()}>
              <SessionSidebar />
            </Match>
            <Match when={!wide()}>
              <box
                position="absolute"
                top={0}
                left={0}
                right={0}
                bottom={0}
                zIndex={1001}
                alignItems="flex-start"
                backgroundColor={RGBA.fromInts(0, 0, 0, 70)}
              >
                <box position="absolute" top={0} left={0} right={0} bottom={0} onMouseDown={() => dismissSidebar()} />
                <SessionSidebar overlay />
              </box>
            </Match>
          </Switch>
        </Show>
        <box
          flexGrow={1}
          minHeight={0}
          alignItems="center"
          paddingTop={2}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
        >
          <box height={4} minHeight={0} flexShrink={1} />
          <box flexShrink={0}>
            <pluginRuntime.Slot name="home_logo" mode="replace">
              <Logo />
            </pluginRuntime.Slot>
          </box>
          <box height={1} minHeight={0} flexShrink={1} />
          <box width="100%" maxWidth={promptMaxWidth()} zIndex={1000} paddingTop={1} flexShrink={0}>
            <pluginRuntime.Slot name="home_prompt" mode="replace" ref={bind}>
              <Prompt ref={bind} right={<pluginRuntime.Slot name="home_prompt_right" />} placeholders={placeholder} />
            </pluginRuntime.Slot>
          </box>
          <pluginRuntime.Slot name="home_bottom" />
          <box flexGrow={1} minHeight={0} />
          <Toast />
        </box>
      </box>
      <box width="100%" flexShrink={0}>
        <Slot path="home.footer" />
      </box>
      <Show when={forms()[0]?.id} keyed>
        {(_) => {
          const form = forms()[0]
          return form ? (
            <box position="absolute" zIndex={2000} left={0} right={0} bottom={1} paddingLeft={2} paddingRight={2}>
              <box width="100%">
                <FormPrompt form={form} />
              </box>
            </box>
          ) : null
        }}
      </Show>
    </>
  )
}

function UpdateNotification(props: { width: number }) {
  const update = useUpdateNotification()
  const exit = useExit()
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)
  const backdrop = () => (hovered() ? theme.background.action.primary.hovered : theme.background.base)
  createEffect(() => {
    update.notification()
    setHovered(false)
  })

  return (
    <Show when={update.notification()} keyed>
      {(state) => {
        const remote = state.source === "server" && state.remote
        return (
          <Show when={!remote || state.type === "available"}>
            <box
              flexShrink={0}
              flexDirection="row"
              justifyContent="center"
              width={props.width}
              maxWidth="100%"
              gap={1}
              backgroundColor={hovered() ? theme.background.action.primary.hovered : undefined}
              onMouseOver={() => setHovered(true)}
              onMouseOut={() => setHovered(false)}
              onMouseUp={() => {
                if (remote) return update.dismiss()
                if (state.type === "installed") return exit()
                update.open?.("notification")
              }}
            >
              <FadeInText fg={theme.text.muted} backdrop={backdrop()}>
                <Show when={!remote}>
                  <span style={{ fg: theme.text.action.primary.selected }}>
                    {state.type === "installed" ? "/exit" : "/update"}
                  </span>
                </Show>
                {remote
                  ? "remote server update available"
                  : state.type === "installed"
                    ? ` restart to use v${state.version}`
                    : ` to install v${state.version}`}
              </FadeInText>
            </box>
          </Show>
        )
      }}
    </Show>
  )
}
