import { TextAttributes, RGBA } from "@opentui/core"
import { For, type JSX } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { logoRows, type LogoTone } from "@/cli/logo"

export function Logo() {
  const { theme } = useTheme()

  const tones: Record<LogoTone, RGBA> = {
    brand: RGBA.fromHex("#D4143C"),
    brandShadow: RGBA.fromHex("#7A0D23"),
    company: RGBA.fromHex("#D4143C"),
    wordmark: RGBA.fromHex("#F7F5EF"),
  }

  return (
    <box>
      <For each={logoRows}>
        {(row) => (
          <box flexDirection="row">
            <For each={row}>
              {(segment) => (
                <text
                  fg={tones[segment.tone]}
                  attributes={segment.bold ? TextAttributes.BOLD : undefined}
                  selectable={false}
                >
                  {segment.text}
                </text>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}
