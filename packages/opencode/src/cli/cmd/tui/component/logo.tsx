import { RGBA } from "@opentui/core"
import { For, type JSX } from "solid-js"
import { useTheme, tint } from "@tui/context/theme"
import { logo } from "@/cli/logo"

// Classic Lash gradient: pink (Dolly) → indigo (Charple)
const GRAD_A = RGBA.fromHex("#FF60FF")
const GRAD_B = RGBA.fromHex("#6B50FF")
const STRIPE_COLOR = RGBA.fromHex("#6B50FF")
const DIAG = "╱"

const LEFT_STRIPES = 6
const RIGHT_STRIPES_BASE = 15

function lerpColor(a: RGBA, b: RGBA, t: number): RGBA {
  return RGBA.fromInts(
    Math.round((a.r + (b.r - a.r) * t) * 255),
    Math.round((a.g + (b.g - a.g) * t) * 255),
    Math.round((a.b + (b.b - a.b) * t) * 255),
  )
}

export function Logo() {
  const { theme } = useTheme()

  const renderGradientLine = (line: string): JSX.Element[] => {
    const totalLen = line.length
    const elements: JSX.Element[] = []

    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      const t = totalLen > 1 ? i / (totalLen - 1) : 0
      const fg = lerpColor(GRAD_A, GRAD_B, t)
      const shadow = tint(theme.background, fg, 0.25)

      switch (char) {
        case "_":
          elements.push(
            <text fg={fg} bg={shadow} selectable={false}>
              {" "}
            </text>,
          )
          break
        case "^":
          elements.push(
            <text fg={fg} bg={shadow} selectable={false}>
              ▀
            </text>,
          )
          break
        case "~":
          elements.push(
            <text fg={shadow} selectable={false}>
              ▀
            </text>,
          )
          break
        default:
          elements.push(
            <text fg={fg} selectable={false}>
              {char}
            </text>,
          )
          break
      }
    }

    return elements
  }

  return (
    <box flexDirection="column">
      <For each={logo.left}>
        {(line, index) => {
          const rightLine = logo.right[index()] ?? ""
          const combined = line + " " + rightLine
          const rightStripes = RIGHT_STRIPES_BASE - index()

          return (
            <box flexDirection="row">
              <text fg={STRIPE_COLOR} selectable={false}>
                {DIAG.repeat(LEFT_STRIPES)}
              </text>
              <text selectable={false}> </text>
              <box flexDirection="row">{renderGradientLine(combined)}</box>
              <text selectable={false}> </text>
              <text fg={STRIPE_COLOR} selectable={false}>
                {DIAG.repeat(Math.max(0, rightStripes))}
              </text>
            </box>
          )
        }}
      </For>
    </box>
  )
}
