// packages/opencode/src/cli/cmd/tui/layout/types.ts
import z from "zod"

export namespace Layout {
  // Window: A rectangular area displaying a single view
  export namespace Window {
    export const Info = z.object({
      type: z.literal("window").default("window"),
      id: z.string(),
      viewID: z.string(),
      focused: z.boolean().default(false),
    })
    export type Info = z.output<typeof Info>

    export function create(input: { id: string; viewID: string; focused?: boolean }): Info {
      return {
        type: "window",
        id: input.id,
        viewID: input.viewID,
        focused: input.focused ?? false,
      }
    }
  }

  // Split: A container dividing space between children
  export namespace Split {
    export const Info: z.ZodType<SplitInfo> = z.lazy(() =>
      z.object({
        type: z.literal("split").default("split"),
        id: z.string(),
        direction: z.enum(["horizontal", "vertical"]),
        children: z.array(z.union([Window.Info, Info])),
        ratios: z.array(z.number()),
      }),
    )

    export type SplitInfo = {
      type: "split"
      id: string
      direction: "horizontal" | "vertical"
      children: Array<Window.Info | SplitInfo>
      ratios: number[]
    }

    export function create(input: {
      id: string
      direction: "horizontal" | "vertical"
      children: Array<Window.Info | SplitInfo>
      ratios: number[]
    }): SplitInfo {
      return {
        type: "split",
        id: input.id,
        direction: input.direction,
        children: input.children,
        ratios: input.ratios,
      }
    }
  }

  // Float: A window with absolute positioning
  export namespace Float {
    export const Info = z.object({
      id: z.string(),
      viewID: z.string(),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      focused: z.boolean().default(false),
    })
    export type Info = z.output<typeof Info>

    export function create(input: {
      id: string
      viewID: string
      x: number
      y: number
      width: number
      height: number
      focused?: boolean
    }): Info {
      return {
        id: input.id,
        viewID: input.viewID,
        x: input.x,
        y: input.y,
        width: input.width,
        height: input.height,
        focused: input.focused ?? false,
      }
    }
  }

  // Root: The top-level layout container
  export namespace Root {
    export const Info = z.object({
      root: z.union([Window.Info, Split.Info]),
      floats: z.array(Float.Info),
      focusedID: z.string(),
    })
    export type Info = z.output<typeof Info>

    export function create(input: {
      root: Window.Info | Split.SplitInfo
      floats: Float.Info[]
      focusedID: string
    }): Info {
      return {
        root: input.root,
        floats: input.floats,
        focusedID: input.focusedID,
      }
    }
  }

  // Node type union for tree traversal
  export type Node = Window.Info | Split.SplitInfo
}
