import { usePlugin } from "@opencode/plugin/gui"
import { Button } from "@opencode/ui/button"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { TextInput } from "@opencode/ui/text-input"
import { Tooltip } from "@opencode/ui/tooltip"
import { debounce } from "@solid-primitives/scheduled"
import { createMemo, createSignal, createUniqueId, For, onCleanup, Show, untrack } from "solid-js"
import type { Viewport } from "./ipc"
import {
  initialViewportControls,
  transitionViewportControls,
  validDimension,
  viewportControlsView,
  type ViewportAction,
  type ViewportControlsEvent,
} from "./viewport-controls-machine"
import { ViewportPresetMenu } from "./viewport-preset-menu"
import { previewScales } from "./viewport-presets"

export function ViewportControls(props: {
  viewport?: Viewport
  autoWidth: number
  autoHeight: number
  effectiveScale: number
  zoomed: boolean
  apply: (viewport: Viewport) => Promise<void>
}) {
  const plugin = usePlugin()
  const hint = createUniqueId()
  const [state, setState] = createSignal(initialViewportControls)
  const view = createMemo(() => viewportControlsView(state(), props))
  const scale = () => view().fixed?.scale

  const scaleLabel = () => {
    const percent = Math.round((scale() ?? props.effectiveScale) * 100)

    if (scale()) return plugin.t("zoom.percent", { percent })

    return props.effectiveScale < 0.01 ? plugin.t("viewport.fitBelowOne") : plugin.t("viewport.fitPercent", { percent })
  }

  const timeout = debounce((attempt: number) => dispatch({ type: "timeout", attempt }), 10_000)

  const dispatch = (event: ViewportControlsEvent) => {
    const next = transitionViewportControls(untrack(state), event)
    setState(next.state)

    if (!next.apply) return
    const { attempt, viewport } = next.apply
    timeout(attempt)
    void props.apply(viewport).then(
      () => dispatch({ type: "succeeded", attempt, report: props.viewport }),
      () => dispatch({ type: "failed", attempt }),
    )
  }

  const action = (event: ViewportAction) =>
    dispatch({
      ...event,
      context: {
        viewport: props.viewport,
        autoWidth: props.autoWidth,
        autoHeight: props.autoHeight,
        zoomed: props.zoomed,
      },
    })

  onCleanup(() => dispatch({ type: "disposed" }))

  return (
    <>
      <ViewportPresetMenu
        selected={view().fixed?.preset ?? (view().fixed ? "custom" : undefined)}
        disabled={props.zoomed}
        onAuto={() => action({ type: "preset.selected" })}
        onSelect={(device) => action({ type: "preset.selected", device })}
      />
      <div
        data-slot="browser-viewport-group"
        role="group"
        aria-label={plugin.t("viewport.dimensions")}
        onFocusOut={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
          dispatch({ type: "blurred" })
        }}
      >
        <For each={["width", "height"] as const}>
          {(axis) => (
            <>
              <Show when={axis === "height"}>
                <span aria-hidden="true">×</span>
              </Show>
              <TextInput
                appearance="small"
                numeric
                dir="ltr"
                inputmode="numeric"
                autocomplete="off"
                disabled={props.zoomed}
                aria-label={plugin.t(axis === "width" ? "viewport.width" : "viewport.height")}
                aria-describedby={view().invalid ? hint : undefined}
                invalid={!validDimension(view().fields[axis])}
                value={view().fields[axis]}
                onInput={(event) => action({ type: "edited", axis, value: event.currentTarget.value })}
              />
            </>
          )}
        </For>
      </div>
      <div data-slot="browser-viewport-group">
        <Menu placement="bottom-end" gutter={4} modal={false}>
          <Menu.Trigger
            as={Button}
            size="small"
            variant="ghost-faint"
            data-slot="browser-viewport-scale"
            aria-label={plugin.t("viewport.scale")}
            aria-description={scaleLabel()}
            disabled={props.zoomed}
          >
            {scaleLabel()}
            <span aria-hidden="true" data-slot="viewport-chevron" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content data-slot="browser-viewport-scale-menu" data-browser-popup>
              <Menu.RadioGroup value={String(scale() ?? "fit")}>
                <Menu.RadioItem value="fit" onSelect={() => action({ type: "scale.selected" })} closeOnSelect>
                  {plugin.t("viewport.fit")}
                </Menu.RadioItem>
                <Menu.Separator />
                <For each={previewScales}>
                  {(factor) => (
                    <Menu.RadioItem
                      value={String(factor)}
                      onSelect={() => action({ type: "scale.selected", scale: factor })}
                      closeOnSelect
                    >
                      {plugin.t("zoom.percent", { percent: factor * 100 })}
                    </Menu.RadioItem>
                  )}
                </For>
              </Menu.RadioGroup>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
        <Tooltip placement="top" value={plugin.t("viewport.rotate")}>
          <IconButton
            variant="ghost-muted"
            size="small"
            aria-label={plugin.t("viewport.rotate")}
            disabled={view().invalid || props.zoomed}
            onClick={() => action({ type: "rotated" })}
            icon={<span aria-hidden="true" data-slot="viewport-rotate-icon" />}
          />
        </Tooltip>
      </div>
      <Show when={view().invalid}>
        <span id={hint} data-slot="browser-viewport-message" role="status">
          {plugin.t("viewport.invalid")}
        </span>
      </Show>
      <Show when={view().error}>
        <span data-slot="browser-viewport-message" role="alert">
          {plugin.t("viewport.error")}
        </span>
      </Show>
    </>
  )
}
