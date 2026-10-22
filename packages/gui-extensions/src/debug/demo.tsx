import { createMemo, createSignal, For, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { createKeyed, useExtension } from "../sdk"
import { simulated } from "./simulated"

type Action = (typeof actions)[number]

// Each action is a real prompt the scripted model recognises by its `[demo:<action> <speed>×]` tag.
const actions = [
  "long",
  "paragraph",
  "code",
  "shell",
  "patch",
  "turn",
  "message",
  "steer",
  "burst",
  "queue",
  "subagent",
  "background",
] as const

const prompts: Record<Action, string> = {
  long: "Walk through the harbor plan in detail",
  paragraph: "Describe the harbor at dawn",
  code: "Show the lantern scheduler",
  shell: "Run the tide checks",
  patch: "Retime the North Mole lantern",
  turn: "Check the lanterns against the tide tables",
  message: "How is the harbor today?",
  steer: "Also include the tide tables",
  burst: "Read every harbor file",
  queue: "Then repaint the pilot steps",
  subagent: "Survey the breakwater in the background",
  background: "Start the lantern preview",
}

// Auto-play's loop: each step waits for the session to settle; `then` lands while the step is still running.
const script: Array<{ action: Action; then?: { action: Action; after: number } }> = [
  { action: "paragraph" },
  { action: "shell" },
  { action: "code" },
  { action: "turn", then: { action: "steer", after: 1_200 } },
  { action: "patch" },
  { action: "burst" },
  { action: "paragraph", then: { action: "queue", after: 400 } },
  { action: "subagent" },
  { action: "background" },
  { action: "message" },
]

export default function Demo() {
  const ctx = useExtension()
  const [speed, setSpeed] = createSignal(1)
  const [playing, setPlaying] = createSignal(false)

  const target = createMemo(
    () => {
      const session = ctx.sessions.current()

      if (!session?.location) return

      return { id: session.id, location: session.location, server: session.server }
    },
    undefined,
    {
      equals: (a, b) =>
        a?.id === b?.id && a?.server.data === b?.server.data && a?.location.directory === b?.location.directory,
    },
  )

  const ready = createMemo(() => {
    const current = target()

    return !!current && simulated(current)
  })

  createKeyed(
    target,
    (current) => void current.server.data.location.provider.sync(current.location).catch(() => undefined),
  )

  const send = (action: Action) => {
    const current = target()

    if (!current || !ready()) return

    return current.server.data.session
      .prompt({
        sessionID: current.id,
        text: `[demo:${action} ${speed()}×] ${prompts[action]}`,
        delivery: action === "queue" ? "queue" : "steer",
      })
      .catch(() => undefined)
  }

  const finish = () => {
    const current = target()

    if (current && ready())
      void current.server.client.session.interrupt({ sessionID: current.id }).catch(() => undefined)
  }

  // Auto-play runs while it is on and the routed session can take demo prompts, and stops with either.
  createKeyed(
    () => playing() && ready() && target(),
    (current) => {
      const abort = new AbortController()
      onCleanup(() => abort.abort())
      void play(current, abort.signal)
    },
  )

  async function play(current: NonNullable<ReturnType<typeof target>>, signal: AbortSignal) {
    const idle = () =>
      current.server.data.session.status(current.id) === "idle" &&
      current.server.data.session.pending.list(current.id).length === 0

    for (let step = 0; !signal.aborted; step = (step + 1) % script.length) {
      const item = script[step]
      void send(item.action)
      await until(() => !idle(), 3_000, signal)

      if (item.then) {
        await wait(item.then.after / speed(), signal)
        void send(item.then.action)
      }

      await until(idle, 60_000, signal)
      await wait(900 / speed(), signal)
    }
  }

  return (
    <Portal>
      <section
        aria-label={ctx.t("demo.title")}
        class="pointer-events-auto fixed bottom-10 left-3 z-50 flex w-[224px] flex-col gap-2 rounded-xl border border-border-base bg-surface-raised-stronger-non-alpha p-2.5 font-mono text-[11px] text-text-strong shadow-[var(--shadow-lg-border-base)]"
      >
        <span class="text-[10px] font-black uppercase tracking-[0.04em] opacity-70">{ctx.t("demo.title")}</span>
        <label class="flex items-center gap-2 text-[10px] font-bold uppercase tabular-nums">
          {ctx.t("demo.speed")}
          <input
            type="range"
            min="0.25"
            max="2"
            step="0.25"
            value={speed()}
            class="min-w-0 flex-1"
            onInput={(event) => setSpeed(Number(event.currentTarget.value))}
          />
          <span class="w-10 text-end">{speed().toFixed(2)}×</span>
        </label>
        <p class="leading-text-tight opacity-70">{ctx.t(ready() ? "demo.hint" : "demo.unavailable")}</p>
        <div class="grid grid-cols-2 gap-1">
          <For each={actions}>
            {(action) => (
              <DemoButton
                disabled={!ready()}
                label={ctx.t(`demo.action.${action}`)}
                onClick={() => void send(action)}
              />
            )}
          </For>
          <DemoButton disabled={!ready()} label={ctx.t("demo.action.finish")} onClick={finish} />
        </div>
        <DemoButton
          active={playing()}
          disabled={!ready()}
          label={ctx.t(playing() ? "demo.autoplay.stop" : "demo.autoplay.start")}
          onClick={() => setPlaying((value) => !value)}
        />
      </section>
    </Portal>
  )
}

function DemoButton(props: { active?: boolean; disabled: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      disabled={props.disabled}
      classList={{
        "min-h-[24px] rounded px-1.5 py-1 text-[10px] font-bold uppercase leading-none hover:bg-surface-raised-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-border-focus disabled:pointer-events-none disabled:opacity-40": true,
        "bg-surface-raised-base text-text-strong": !!props.active,
      }}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })

    function done() {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
  })
}

async function until(check: () => boolean, timeout: number, signal: AbortSignal) {
  const deadline = Date.now() + timeout

  while (!signal.aborted && !check() && Date.now() < deadline) await wait(100, signal)
}
