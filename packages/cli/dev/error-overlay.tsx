/* @refresh skip */
import { BoxRenderable, RGBA, TextAttributes } from "@opentui/core"
import { Portal, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { DEFAULT_THEME, resolveThemeDocument } from "@opencode-ai/theme/tui"
import { onCleanup, onMount } from "solid-js"

export function ErrorOverlay(props: { component: string; error: unknown }) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  // The failing component may itself be a theme provider, so this fallback owns its palette.
  const theme = resolveThemeDocument(DEFAULT_THEME, renderer.themeMode ?? "dark").contextual.overlay
  const focus = renderer.currentFocusedRenderable
  onMount(() => focus?.blur())
  onCleanup(() => {
    if (focus && !focus.isDestroyed) focus.focus()
  })

  return (
    <Portal
      ref={(container) => {
        if (!(container instanceof BoxRenderable)) return
        // Anchor Portal's wrapper above the app rather than after it in root layout.
        container.position = "absolute"
        container.left = 0
        container.top = 0
        container.zIndex = 5000
      }}
    >
      <box
        position="absolute"
        left={0}
        top={0}
        width={dimensions().width}
        height={dimensions().height}
        alignItems="center"
        justifyContent="center"
        backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
        onMouseDown={(event) => event.stopPropagation()}
        onMouseUp={(event) => event.stopPropagation()}
      >
        <box
          width={Math.min(72, Math.max(1, dimensions().width - 4))}
          maxHeight={Math.max(1, dimensions().height - 2)}
          backgroundColor={theme.background.default}
          paddingX={2}
          paddingY={1}
          gap={1}
        >
          <text flexShrink={0} fg={theme.text.feedback.error.default} attributes={TextAttributes.BOLD}>
            Error while hot reloading
          </text>
          <text maxHeight={Math.max(1, dimensions().height - 9)} fg={theme.text.default}>
            {props.error instanceof Error ? props.error.message : String(props.error)}
          </text>
          <text flexShrink={0} fg={theme.text.subdued}>
            {props.component} · Fix the component and save to retry.
          </text>
        </box>
      </box>
    </Portal>
  )
}
