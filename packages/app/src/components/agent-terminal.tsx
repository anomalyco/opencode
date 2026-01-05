import { createEffect, createMemo, For, on, Show, type JSX } from "solid-js"
import { useAgentTerminal, type BashCommand } from "@/context/agent-terminal"
import { resolveThemeVariant, useTheme } from "@opencode-ai/ui/theme"
import AnsiToHtml from "ansi-to-html"

function useAnsiConverter() {
  const theme = useTheme()

  return createMemo(() => {
    const isDark = theme.mode() === "dark"
    const currentTheme = theme.themes()[theme.themeId()]

    // Default ANSI colors
    const defaultColors = isDark
      ? {
          fg: "#d4d4d4",
          black: "#1a1a1a",
          red: "#ff5f56",
          green: "#5af78e",
          yellow: "#f3f99d",
          blue: "#57c7ff",
          magenta: "#ff6ac1",
          cyan: "#9aedfe",
          white: "#f1f1f0",
          brightBlack: "#686868",
          brightRed: "#ff6e6e",
          brightGreen: "#69ff94",
          brightYellow: "#ffffa5",
          brightBlue: "#69a0ff",
          brightMagenta: "#ff77ff",
          brightCyan: "#a4ffff",
          brightWhite: "#ffffff",
        }
      : {
          fg: "#211e1e",
          black: "#000000",
          red: "#c91b00",
          green: "#00c200",
          yellow: "#c7c400",
          blue: "#0068ff",
          magenta: "#c930c7",
          cyan: "#00c5c7",
          white: "#c7c7c7",
          brightBlack: "#686868",
          brightRed: "#ff6e67",
          brightGreen: "#5ffa68",
          brightYellow: "#fffc67",
          brightBlue: "#6871ff",
          brightMagenta: "#ff77ff",
          brightCyan: "#60fdff",
          brightWhite: "#ffffff",
        }

    // Pull semantic colors from theme if available
    if (currentTheme) {
      const variant = isDark ? currentTheme.dark : currentTheme.light
      if (variant?.seeds) {
        const resolved = resolveThemeVariant(variant, isDark)
        // Map theme semantic colors to ANSI where appropriate
        if (resolved["syntax-critical"]) defaultColors.red = resolved["syntax-critical"] as string
        if (resolved["syntax-success"]) defaultColors.green = resolved["syntax-success"] as string
        if (resolved["syntax-warning"]) defaultColors.yellow = resolved["syntax-warning"] as string
        if (resolved["syntax-info"]) defaultColors.cyan = resolved["syntax-info"] as string
        if (resolved["text-base"]) defaultColors.fg = resolved["text-base"] as string
      }
    }

    return new AnsiToHtml({
      fg: defaultColors.fg,
      bg: "transparent",
      colors: [
        defaultColors.black,
        defaultColors.red,
        defaultColors.green,
        defaultColors.yellow,
        defaultColors.blue,
        defaultColors.magenta,
        defaultColors.cyan,
        defaultColors.white,
        defaultColors.brightBlack,
        defaultColors.brightRed,
        defaultColors.brightGreen,
        defaultColors.brightYellow,
        defaultColors.brightBlue,
        defaultColors.brightMagenta,
        defaultColors.brightCyan,
        defaultColors.brightWhite,
      ],
      escapeXML: true,
    })
  })
}

function CommandBlock(props: { command: BashCommand }) {
  const convert = useAnsiConverter()

  return (
    <>
      <div class="text-syntax-keyword">
        <span class="text-text-dimmed-base select-none">$ </span>
        {props.command.command}
      </div>
      <Show when={props.command.output}>
        <div class="text-text-base whitespace-pre-wrap" innerHTML={convert().toHtml(props.command.output)} />
      </Show>
    </>
  )
}

export function AgentTerminal(): JSX.Element {
  const agentTerminal = useAgentTerminal()
  const theme = useTheme()
  let container: HTMLDivElement | undefined

  const backgroundColor = createMemo(() => {
    const mode = theme.mode()
    const currentTheme = theme.themes()[theme.themeId()]
    if (!currentTheme) return mode === "dark" ? "#191515" : "#fcfcfc"
    const variant = mode === "dark" ? currentTheme.dark : currentTheme.light
    if (!variant?.seeds) return mode === "dark" ? "#191515" : "#fcfcfc"
    const resolved = resolveThemeVariant(variant, mode === "dark")
    return resolved["background-stronger"] ?? (mode === "dark" ? "#191515" : "#fcfcfc")
  })

  // Auto-scroll to bottom when new output arrives
  createEffect(
    on(
      () => agentTerminal.commands(),
      () => {
        if (container) {
          container.scrollTo({ top: container.scrollHeight, behavior: "smooth" })
        }
      },
    ),
  )

  return (
    <div
      ref={container}
      class="size-full overflow-auto px-6 py-3 font-mono text-13-regular"
      style={{ "background-color": backgroundColor() }}
    >
      <Show when={agentTerminal.commands().length === 0}>
        <div class="text-text-dimmed-base">Agent commands will appear here</div>
      </Show>
      <For each={agentTerminal.commands()}>{(cmd) => <CommandBlock command={cmd} />}</For>
    </div>
  )
}
