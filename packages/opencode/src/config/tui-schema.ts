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
  cursor_style: z.enum(["block", "line", "underline"]).optional().describe("Cursor style for TUI textareas"),
  cursor_blink: z.boolean().optional().describe("Whether TUI textarea cursor blinks"),
  cursor_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$|^[a-zA-Z][a-zA-Z0-9_]*$/, "Invalid cursor color format")
    .optional()
    .describe("Cursor color for TUI textareas. Supports hex (#RRGGBB) or theme color name."),
})

export const TuiInfo = z
  .object({
    $schema: z.string().optional(),
    theme: z.string().optional(),
    keybinds: KeybindOverride.optional(),
  })
  .extend(TuiOptions.shape)
  .strict()
