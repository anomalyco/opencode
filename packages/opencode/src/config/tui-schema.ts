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
  status_line: z
    .object({
      templates: z
        .record(z.enum(["terminal_title", "session_footer", "home_footer"]), z.string())
        .optional()
        .describe("Template strings per display target with {variable:format} placeholders"),
      interval: z
        .number()
        .int()
        .min(1)
        .max(300)
        .optional()
        .describe("Polling interval in seconds"),
      commands: z
        .record(z.string(), z.string())
        .optional()
        .describe("Named shell commands available as {shell:name} in templates"),
    })
    .optional()
    .describe("Status line template configuration"),
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
