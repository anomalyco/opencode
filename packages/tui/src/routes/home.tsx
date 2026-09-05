import { Prompt, type PromptRef } from "../component/prompt"
import { createEffect, createMemo, createSignal, Match, onMount, Show, Switch, untrack } from "solid-js"
import { Logo } from "../component/logo"
import { useArgs } from "../context/args"
import { useRouteData } from "../context/route"
import { usePromptRef } from "../context/prompt"
import { useLocal } from "../context/local"
import { useEditorContext } from "../context/editor"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { FormPrompt } from "./session/form"
import { Slot } from "../plugin/render"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes, type RGBA } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useUpdateNotification } from "../context/update-notification"
import { FadeInText } from "../component/fade-in-text"
import { stringWidth } from "../util/string-width"

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
  // Global MCP elicitations can arrive without a session route, so keep them reachable from Home.
  const currentLocation = () => route.location ?? data.location.default()
  const forms = createMemo(() => data.session.form.list("global", currentLocation()) ?? [])
  let sent = false

  // Track only the route location and (when absent) the default location; location.set
  // reads other signals internally and tracking them would re-assert the route location
  // after the user overrides it with /cd.
  createEffect(() => {
    const target = currentLocation()
    untrack(() => location.set(target))
  })

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

  // Wait for the model store to be ready before auto-submitting --prompt.
  createEffect(() => {
    const r = ref()
    if (sent) return
    if (!r) return
    if (!local.model.ready) return
    if (!args.prompt) return
    if (r.current.text !== args.prompt) return
    sent = true
    r.submit()
  })

  return (
    <>
      <box
        flexGrow={1}
        alignItems="center"
        paddingLeft={dimensions().width < 44 ? 1 : 2}
        paddingRight={dimensions().width < 44 ? 1 : 2}
      >
        <box flexGrow={1} minHeight={0} />
        <box height={3} minHeight={0} flexShrink={1} />
        <box flexShrink={0}>
          <Logo />
        </box>
        <box height={1} minHeight={0} flexShrink={1} />
        <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1} flexShrink={0} position="relative">
          <Prompt ref={bind} placeholders={placeholder} disabled={forms().length > 0} />
          <box position="absolute" top="100%" left={0} right={0} alignItems="center">
            <UpdateNotification />
          </box>
        </box>
        <box flexGrow={1} minHeight={0} />
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

function UpdateNotification() {
  const update = useUpdateNotification()
  const theme = useTheme()
  const remoteMessage = "A remote server cannot be updated from here. Updating it is recommended."
  const [hovered, setHovered] = createSignal<"primary" | "close">()
  createEffect(() => {
    update.notification()
    setHovered(undefined)
  })

  return (
    <Show when={update.notification()} keyed>
      {(state) => (
        <box flexShrink={0} marginTop={4} alignItems="center">
          <Switch>
            <Match when={state.source === "client" || !state.remote}>
              <box
                alignItems="center"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={hovered() === "primary" ? theme.background.action.primary.hovered : undefined}
                onMouseOver={() => setHovered("primary")}
                onMouseOut={() => setHovered(undefined)}
                onMouseUp={() => update.open?.("notification")}
              >
                <UpdateMessage
                  title={state.type === "installed" ? "Update installed" : "Update available"}
                  description={`Version ${state.version} is ${state.type === "installed" ? "installed" : "available"}. /update for more details`}
                  backdrop={
                    hovered() === "primary" ? theme.background.action.primary.hovered : theme.background.default
                  }
                />
              </box>
            </Match>
            <Match when={state.type === "available" && state.source === "server" && state.remote}>
              <box alignItems="center">
                <UpdateMessage
                  title="Server update available"
                  description={remoteMessage}
                  backdrop={theme.background.default}
                />
                <FadeInText
                  fg={theme.text.subdued}
                  backdrop={hovered() === "close" ? theme.background.action.primary.hovered : theme.background.default}
                  sweepWidth={stringWidth(remoteMessage)}
                  sweepOffset={Math.floor((stringWidth(remoteMessage) - stringWidth("Close")) / 2)}
                  marginTop={1}
                  paddingLeft={1}
                  paddingRight={1}
                  bg={hovered() === "close" ? theme.background.action.primary.hovered : undefined}
                  onMouseOver={() => setHovered("close")}
                  onMouseOut={() => setHovered(undefined)}
                  onMouseUp={update.dismiss}
                >
                  Close
                </FadeInText>
              </box>
            </Match>
          </Switch>
        </box>
      )}
    </Show>
  )
}

function UpdateMessage(props: { title: string; description: string; backdrop: RGBA }) {
  const theme = useTheme()
  const titleWidth = stringWidth(props.title)
  const descriptionWidth = stringWidth(props.description)
  const width = Math.max(titleWidth, descriptionWidth)
  return (
    <FadeInText width={width} height={2} wrapMode="none" fg={theme.text.default} backdrop={props.backdrop}>
      <span style={{ fg: theme.text.action.primary.selected, attributes: TextAttributes.BOLD }}>
        {" ".repeat(Math.floor((width - titleWidth) / 2))}
        {props.title}
      </span>
      {"\n"}
      <span style={{ fg: theme.text.subdued }}>
        {" ".repeat(Math.floor((width - descriptionWidth) / 2))}
        {props.description}
      </span>
    </FadeInText>
  )
}
