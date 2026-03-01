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
})

export const TuiInfo = z
  .object({
    $schema: z.string().optional(),
    theme: z.string().optional(),
    theme_mode: z
      .enum(["light", "dark", "system"])
      .optional()
      .describe(
        "Override the detected terminal color scheme. Set to 'light' or 'dark' to force a mode, or 'system' to auto-detect from terminal.",
      ),
    keybinds: KeybindOverride.optional(),
  })
  .extend(TuiOptions.shape)
  .strict()
