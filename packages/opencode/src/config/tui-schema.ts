import z from "zod"
import { Config } from "./config"

const KeybindOverride = z
  .object(
    Object.fromEntries(Object.keys(Config.Keybinds.shape).map((key) => [key, z.string().optional()])) as Record<
      string,
      z.ZodOptional<z.ZodString>
    >,
  )
  .strict()

export const TuiOptions = z.object({
  scroll_speed: z.number().min(0.001).optional().describe("TUI scroll speed"),
  scroll_acceleration: z
    .object({
      enabled: z.boolean().describe("Enable scroll acceleration"),
    })
    .optional()
    .describe("Scroll acceleration settings"),
  diff_style: z
    .enum(["auto", "stacked"])
    .optional()
    .describe("Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column"),
  prompt_bar_animation: z
    .object({
      enabled: z.boolean().optional().describe("Enable prompt bar animation plugin styling"),
      plugin: z.string().optional().describe("Prompt bar animation plugin id"),
      options: z
        .object({
          diagonal_ripple: z
            .object({
              speed: z.number().min(0).optional().describe("Ripple animation speed"),
              intensity: z.number().min(0).max(1).optional().describe("Ripple effect intensity"),
              direction: z
                .enum(["down-right", "down-left", "up-right", "up-left"])
                .optional()
                .describe("Ripple propagation direction"),
            })
            .optional()
            .describe("Diagonal ripple effect options"),
        })
        .optional()
        .describe("Animation plugin options"),
    })
    .optional()
    .describe("Prompt bar animation settings"),
})

export const TuiInfo = z
  .object({
    $schema: z.string().optional(),
    theme: z.string().optional(),
    keybinds: KeybindOverride.optional(),
  })
  .extend(TuiOptions.shape)
  .strict()
