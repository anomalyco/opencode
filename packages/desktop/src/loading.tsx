import { render } from "solid-js/web"
import { MetaProvider } from "@solidjs/meta"
import "@opencode-ai/app/index.css"
import { Font } from "@opencode-ai/ui/font"
import { Splash } from "@opencode-ai/ui/logo"
import "./styles.css"
import { createSignal, Match, onMount } from "solid-js"
import { commands, events, InitStep } from "./bindings"
import { Channel } from "@tauri-apps/api/core"
import { Switch } from "solid-js"

const root = document.getElementById("root")!

render(() => {
  let splash!: SVGSVGElement
  const [state, setState] = createSignal<InitStep | null>(null)

  const channel = new Channel<InitStep>()
  channel.onmessage = (e) => setState(e)
  commands.awaitInitialization(channel as any).then(() => {
    const currentOpacity = getComputedStyle(splash).opacity

    splash.style.animation = "none"
    splash.style.animationPlayState = "paused"
    splash.style.opacity = currentOpacity

    requestAnimationFrame(() => {
      splash.style.transition = "opacity 0.3s ease"
      requestAnimationFrame(() => {
        splash.style.opacity = "1"
      })
    })
  })

  return (
    <MetaProvider>
      <div class="w-screen h-screen bg-background-base flex items-center justify-center">
        <Font />
        <div class="flex flex-col items-center gap-10">
          <Splash ref={splash} class="h-25 animate-[pulse-splash_2s_ease-in-out_infinite]" />
          <span class="text-text-base">
            <Switch fallback="Just a moment...">
              <Match when={state()?.phase === "done"}>
                {(_) => {
                  onMount(() => {
                    setTimeout(() => events.loadingWindowComplete.emit(null), 1000)
                  })

                  return "All done"
                }}
              </Match>
              <Match when={state()?.phase === "sqlite_waiting"}>
                {(_) => {
                  const textItems = [
                    "Just a moment...",
                    "Migrating your database",
                    "This could take a couple of minutes",
                  ]
                  const [textIndex, setTextIndex] = createSignal(0)

                  onMount(async () => {
                    await new Promise((res) => setTimeout(res, 3000))
                    setTextIndex(1)
                    await new Promise((res) => setTimeout(res, 6000))
                    setTextIndex(2)
                  })

                  return <>{textItems[textIndex()]}</>
                }}
              </Match>
            </Switch>
          </span>
        </div>
      </div>
    </MetaProvider>
  )
}, root)
