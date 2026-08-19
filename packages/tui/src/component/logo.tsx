import { NativeImage, type RGBA, TextAttributes, type TerminalCapabilities } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, type JSX, onCleanup, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { tint } from "../theme/color"
import { go, logo } from "../logo"

const halves: Record<string, readonly [number, number]> = {
  "█": [1, 1],
  "▀": [1, 0],
  "▄": [0, 1],
  _: [2, 2],
  "^": [1, 2],
  "~": [2, 0],
  ",": [0, 2],
}

function wordmarkProtocol(capabilities: TerminalCapabilities | null | undefined) {
  if (capabilities?.sixel) return "sixel" as const
  if (capabilities?.kitty_graphics) return "kitty" as const
}

export function Logo() {
  const theme = useTheme()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const [protocol, setProtocol] = createSignal(wordmarkProtocol(renderer.capabilities))
  const updateCapabilities = (capabilities: TerminalCapabilities) => setProtocol(wordmarkProtocol(capabilities))
  renderer.on("capabilities", updateCapabilities)
  onCleanup(() => renderer.off("capabilities", updateCapabilities))

  const renderLine = (line: string, fg: RGBA, bold: boolean): JSX.Element[] => {
    const shadow = tint(theme.background.default, fg, 0.25)
    const attrs = bold ? TextAttributes.BOLD : undefined
    return Array.from(line).map((char) => {
      if (char === "_") {
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            {" "}
          </text>
        )
      }
      if (char === "^") {
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }
      if (char === "~") {
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }
      if (char === ",") {
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▄
          </text>
        )
      }
      return (
        <text fg={fg} attributes={attrs} selectable={false}>
          {char}
        </text>
      )
    })
  }

  const art = createMemo(() => {
    const imageProtocol = protocol()
    if (!imageProtocol) return
    const rows =
      dimensions().height < 12
        ? []
        : dimensions().width < 22
          ? go.right.slice(1).map((line) => [{ line, color: theme.text.default }])
          : dimensions().width < 44
            ? [
              ...logo.left.slice(1).map((line) => [{ line, color: theme.text.subdued }]),
              ...logo.right.map((line) => [{ line, color: theme.text.default }]),
            ]
            : logo.left.map((line, index) => [
              { line, color: theme.text.subdued },
              { line: " ", color: theme.background.default },
              { line: logo.right[index], color: theme.text.default },
            ])
    if (rows.length === 0) return

    const width = Math.max(...rows.map((row) => row.reduce((total, segment) => total + segment.line.length, 0)))
    const pixels = new Uint8Array(width * rows.length * 2 * 4)
    const background = theme.background.default.toInts()
    for (let offset = 0; offset < pixels.length; offset += 4) {
      pixels[offset] = background[0]
      pixels[offset + 1] = background[1]
      pixels[offset + 2] = background[2]
      pixels[offset + 3] = 255
    }

    rows.forEach((row, y) => {
      let start = 0
      row.forEach((segment) => {
        const foreground = segment.color.toInts()
        const shadow = tint(theme.background.default, segment.color, 0.25).toInts()
        const palette = [background, foreground, shadow]
        Array.from(segment.line).forEach((char, x) => {
          const fill = halves[char] ?? [0, 0]
          fill.forEach((color, half) => {
            const offset = ((y * 2 + half) * width + start + x) * 4
            pixels[offset] = palette[color][0]
            pixels[offset + 1] = palette[color][1]
            pixels[offset + 2] = palette[color][2]
            pixels[offset + 3] = 255
          })
        })
        start += segment.line.length
      })
    })

    const image = NativeImage.fromRgba(pixels, width, rows.length * 2)
    const source = image.resize({ width: width * 16, height: rows.length * 32, kernel: "nearest" })
    image.dispose()
    onCleanup(() => source.dispose())
    return { source, width, height: rows.length, protocol: imageProtocol }
  })

  return (
    <Show
      when={art()}
      fallback={
        <box>
          {dimensions().height < 12 ? null : dimensions().width < 22 ? (
            <For each={go.right.slice(1)}>
              {(line) => <box flexDirection="row">{renderLine(line, theme.text.default, true)}</box>}
            </For>
          ) : dimensions().width < 44 ? (
            <>
              <For each={logo.left.slice(1)}>
                {(line) => <box flexDirection="row">{renderLine(line, theme.text.subdued, false)}</box>}
              </For>
              <For each={logo.right}>
                {(line) => <box flexDirection="row">{renderLine(line, theme.text.default, true)}</box>}
              </For>
            </>
          ) : (
            <For each={logo.left}>
              {(line, index) => (
                <box flexDirection="row" gap={1}>
                  <box flexDirection="row">{renderLine(line, theme.text.subdued, false)}</box>
                  <box flexDirection="row">{renderLine(logo.right[index()], theme.text.default, true)}</box>
                </box>
              )}
            </For>
          )}
        </box>
      }
    >
      {(value) => (
        <image
          source={value().source}
          width={value().width}
          height={value().height}
          fit="fill"
          protocol={value().protocol}
        />
      )}
    </Show>
  )
}
