import { createSignal, onMount, onCleanup, For } from "solid-js"
import { useTheme } from "../context/theme"

const LOGO_LINES = [
  { ziq: "███████╗██╗ ██████╗ ", code: "  ██████╗ ██████╗ ██████╗ ███████╗" },
  { ziq: "╚══███╔╝██║██╔═══██╗", code: " ██╔════╝██╔═══██╗██╔══██╗██╔════╝" },
  { ziq: "  ███╔╝ ██║██║   ██║", code: " ██║     ██║   ██║██║  ██║█████╗  " },
  { ziq: " ███╔╝  ██║██║▄▄ ██║", code: " ██║     ██║   ██║██║  ██║██╔══╝  " },
  { ziq: "███████╗██║╚██████╔╝", code: " ╚██████╗╚██████╔╝██████╔╝███████╗" },
  { ziq: "╚══════╝╚═╝ ╚══▀▀═╝ ", code: "  ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝" },
]

export function Logo() {
  const { theme } = useTheme()
  const [pulse, setPulse] = createSignal(0)

  onMount(() => {
    const timer = setInterval(() => {
      setPulse((p) => (p + 1) % LOGO_LINES.length)
    }, 280)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <box alignItems="center" gap={1}>
      {/* ── Block Logo Hero with Timed Glow & Yellow Contrast Shadow ── */}
      <box
        flexDirection="column"
        alignItems="center"
        paddingTop={1}
        paddingBottom={1}
      >
        <For each={LOGO_LINES}>
          {(line, idx) => {
            const isPulsing = () => idx() === pulse()
            return (
              <box flexDirection="row" alignItems="center">
                {/* ZIQ Part */}
                <text
                  fg={isPulsing() ? theme.warning : theme.accent}
                >
                  <b>{line.ziq}</b>
                </text>

                {/* Hyphen Bridge */}
                <text fg={theme.warning}>
                  <b>{idx() === 2 ? " ── " : "    "}</b>
                </text>

                {/* CODE Part */}
                <text
                  fg={isPulsing() ? theme.warning : theme.primary}
                >
                  <b>{line.code}</b>
                </text>
              </box>
            )
          }}
        </For>

        {/* Contrast Yellow / Amber Shadow Underline */}
        <box
          flexDirection="row"
          paddingTop={0}
        >
          <text fg={theme.warning}>
            {"▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀"}
          </text>
        </box>
      </box>

      {/* Feature Badges */}
      <box flexDirection="row" gap={2} paddingTop={0}>
        <text fg={theme.info}>
          <b>[⚡ DGX Qwen 27B · 131k Context]</b>
        </text>
        <text fg={theme.success}>
          <b>[🧠 Personalization: Active]</b>
        </text>
        <text fg={theme.warning}>
          <b>[🛡️ Quality Gate: V2]</b>
        </text>
      </box>
    </box>
  )
}
