import { createEffect, createSignal, on } from "solid-js"
import { ResizeHandle, type ResizeHandleProps } from "./resize-handle"

type Args = Required<Pick<ResizeHandleProps, "direction" | "edge" | "size" | "min" | "max" | "collapseThreshold">>

export default {
  title: "UI/ResizeHandle",
  id: "components-resize-handle",
  component: ResizeHandle,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Drag the handle to resize the panel. A positive collapse threshold lets a drag below that size collapse it on release.",
      },
    },
  },
  args: { direction: "horizontal", edge: "end", size: 240, min: 120, max: 480, collapseThreshold: 0 },
  argTypes: {
    direction: { control: "select", options: ["horizontal", "vertical"] },
    edge: { control: "select", options: ["start", "end"] },
    size: { control: { type: "range", min: 120, max: 320, step: 1 } },
    min: { control: { type: "range", min: 40, max: 120, step: 1 } },
    max: { control: { type: "range", min: 320, max: 600, step: 1 } },
    collapseThreshold: { control: { type: "range", min: 0, max: 200, step: 1 } },
  },
  render: (args: Args) => {
    const [size, setSize] = createSignal(args.size)

    createEffect(
      on(
        () => [args.direction, args.edge, args.min, args.max, args.collapseThreshold, args.size],
        () => setSize(args.size),
      ),
    )

    const horizontal = () => args.direction === "horizontal"

    return (
      <div class="grid gap-2">
        <div class="text-xs text-v2-text-text-muted">{size() === 0 ? "Collapsed" : `Size: ${size()}px`}</div>
        <div
          style={{
            display: "flex",
            "flex-direction": horizontal() ? "row" : "column",
            "justify-content": args.edge === "start" ? "flex-end" : "flex-start",
            width: horizontal() ? `${args.max}px` : "220px",
            height: horizontal() ? "48px" : `${args.max}px`,
          }}
        >
          <div
            style={{
              position: "relative",
              width: horizontal() ? `${size()}px` : "100%",
              height: horizontal() ? "100%" : `${size()}px`,
              "background-color": "var(--background-stronger)",
              "border-radius": "6px",
            }}
          >
            <ResizeHandle
              {...args}
              size={size()}
              onResize={setSize}
              onCollapse={() => setSize(0)}
              style="border:1px dashed color-mix(in oklab, var(--text-base) 20%, transparent)"
            />
          </div>
        </div>
      </div>
    )
  },
}

export const Basic = {}

export const Vertical = { args: { direction: "vertical", edge: "start", size: 180, max: 320 } }

export const Collapse = { args: { size: 200, min: 80, max: 360, collapseThreshold: 100 } }

export const EdgeStart = { args: { edge: "start" } }
