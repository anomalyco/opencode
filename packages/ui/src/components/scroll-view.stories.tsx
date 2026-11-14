import { For, Show } from "solid-js"
import { ScrollView, type ScrollViewProps } from "./scroll-view"

type Args = Required<Pick<ScrollViewProps, "orientation" | "thumbVisibility">> & { rows: number; rtl: boolean }

function Preview(props: Args) {
  return (
    <div class="grid w-96 max-w-full gap-2 text-sm">
      <div class="font-medium">Build history</div>
      {/* Start at the new inline edge when the inspector switches direction. */}
      <Show when={props.rtl ? "rtl" : "inherit"} keyed>
        {(direction) => (
          <ScrollView
            dir={direction === "rtl" ? "rtl" : undefined}
            orientation={props.orientation}
            thumbVisibility={props.thumbVisibility}
            class="h-40 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01"
          >
            <ol
              class="p-2"
              classList={{
                "min-w-[680px]": props.orientation === "both",
                "grid h-full auto-cols-[320px] grid-flow-col grid-rows-4": props.orientation === "horizontal",
              }}
            >
              <For each={Array.from({ length: props.rows }, (_, i) => i + 1)}>
                {(build) => (
                  <li class="flex h-8 items-center justify-between gap-4 px-2">
                    <span>Build {build}</span>
                    <Show when={props.orientation !== "vertical"}>
                      <span class="text-v2-text-text-muted">Release checks</span>
                    </Show>
                    <span class="text-v2-text-text-muted">Passed</span>
                  </li>
                )}
              </For>
            </ol>
          </ScrollView>
        )}
      </Show>
      <p class="text-xs text-v2-text-text-muted">Focus the list to scroll with the keyboard, or drag a thumb.</p>
    </div>
  )
}

export default {
  title: "UI/ScrollView",
  id: "ui-scroll-view",
  component: Preview,
  args: { orientation: "vertical", thumbVisibility: "hover", rows: 20, rtl: false } satisfies Args,
  argTypes: {
    orientation: { control: "select", options: ["vertical", "horizontal", "both"] },
    thumbVisibility: { control: "select", options: ["hover", "scroll"] },
    rows: { control: { type: "range", min: 1, max: 60, step: 1 } },
  },
}

export const Vertical = {}

export const Horizontal = { args: { orientation: "horizontal", rows: 12 } }

export const BothAxes = { args: { orientation: "both" } }

export const Fits = { args: { rows: 3 } }

export const ScrollOnly = { args: { thumbVisibility: "scroll" } }

export const RightToLeft = { args: { orientation: "both", rtl: true } }
