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
  spinner: z
    .object({
      interval: z.number().min(10).max(500).optional().describe("Milliseconds between animation frames (default: 80)"),
      width: z.number().min(4).max(32).optional().describe("Number of characters in the scanner bar (default: 8)"),
      style: z.enum(["blocks", "diamonds"]).optional().describe("Character style for the scanner (default: blocks)"),
      hold_start: z.number().min(0).max(200).optional().describe("Frames to hold at the left/start position (default: 60)"),
      hold_end: z.number().min(0).max(200).optional().describe("Frames to hold at the right/end position (default: 20)"),
      trail_steps: z.number().min(2).max(12).optional().describe("Number of gradient steps in the trail (default: 4)"),
      inactive_factor: z.number().min(0).max(1).optional().describe("Alpha for inactive dots, 0=invisible 1=full (default: 0.5)"),
      min_alpha: z.number().min(0).max(1).optional().describe("Minimum alpha during fade, higher=more visible pulse (default: 0.4)"),
    })
    .optional()
    .describe("Spinner/scanner animation configuration"),
})

export const TuiInfo = z
  .object({
    $schema: z.string().optional(),
    theme: z.string().optional(),
    keybinds: KeybindOverride.optional(),
    plugin: Config.PluginSpec.array().optional(),
    plugin_enabled: z.record(z.string(), z.boolean()).optional(),
  })
  .extend(TuiOptions.shape)
  .strict()
