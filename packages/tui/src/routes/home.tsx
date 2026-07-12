import { Prompt, type PromptRef } from "../component/prompt"
import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js"
import { Logo } from "../component/logo"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useRouteData } from "../context/route"
import { usePromptRef } from "../context/prompt"
import { useLocal } from "../context/local"
import { usePluginRuntime } from "../plugin/runtime"
import { useEditorContext } from "../context/editor"
import { HomeSessionDestinationProvider } from "./home/session-destination"
import { useData } from "../context/data"
import { LocationProvider } from "../context/location"
import { FormPrompt } from "./session/form"

let once = false
const placeholder = {
  normal: ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"],
  shell: ["ls -la", "git status", "pwd"],
}

export function Home() {
  const pluginRuntime = usePluginRuntime()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const [ref, setRef] = createSignal<PromptRef | undefined>()
  const args = useArgs()
  const local = useLocal()
  const editor = useEditorContext()
  const data = useData()
  // Global MCP elicitations can arrive without a session route, so keep them reachable from Home.
  const forms = createMemo(() => data.session.form.list("global", data.location.default()) ?? [])
  let sent = false

  onMount(() => {
    editor.clearSelection()
  })

  const bind = (r: PromptRef | undefined) => {
    setRef(r)
    promptRef.set(r)
    if (once || !r) return
    if (route.prompt) {
      r.set(route.prompt)
      once = true
      return
    }
    if (!args.prompt) return
    r.set({ text: args.prompt, files: [], agents: [], pasted: [] })
    once = true
  }

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
    <LocationProvider location={data.location.default()}>
      <HomeSessionDestinationProvider>
        <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
          <box flexGrow={1} minHeight={0} />
          <box height={4} minHeight={0} flexShrink={1} />
          <box flexShrink={0}>
            <pluginRuntime.Slot name="home_logo" mode="replace">
              <Logo />
            </pluginRuntime.Slot>
          </box>
          <box height={1} minHeight={0} flexShrink={1} />
          <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1} flexShrink={0}>
            <pluginRuntime.Slot name="home_prompt" mode="replace" ref={bind}>
              <Prompt
                ref={bind}
                right={<pluginRuntime.Slot name="home_prompt_right" />}
                placeholders={placeholder}
                disabled={forms().length > 0}
              />
            </pluginRuntime.Slot>
          </box>
          <pluginRuntime.Slot name="home_bottom" />
          <box flexGrow={1} minHeight={0} />
          <Toast />
        </box>
        <box width="100%" flexShrink={0}>
          <pluginRuntime.Slot name="home_footer" mode="single_winner" />
        </box>
        <Show when={forms()[0]?.id} keyed>
          {(_) => {
            const form = forms()[0]
            return form ? (
              <box
                position="absolute"
                zIndex={2000}
                left={0}
                right={0}
                bottom={1}
                paddingLeft={2}
                paddingRight={2}
              >
                <box width="100%">
                  <FormPrompt form={form} />
                </box>
              </box>
            ) : null
          }}
        </Show>
      </HomeSessionDestinationProvider>
    </LocationProvider>
  )
}
