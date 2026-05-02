import z from "zod"
import { ConfigPlugin } from "@/config/plugin"
import { ConfigKeybinds } from "@/config/keybinds"

const KeybindOverride = z
  .object(
    Object.fromEntries(Object.keys(ConfigKeybinds.Keybinds.shape).map((key) => [key, z.string().optional()])) as Record<
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
  mouse: z.boolean().optional().describe("Enable or disable mouse capture (default: true)"),
})

export const TuiInfo = z
  .object({
    $schema: z.string().optional(),
    theme: z.string().optional(),
    keybinds: KeybindOverride.optional(),
    plugin: ConfigPlugin.Spec.zod.array().optional(),
    plugin_enabled: z.record(z.string(), z.boolean()).optional(),
    placeholders: z
      .object({
        input: z
          .array(z.string())
          .optional()
          .describe(
            "Replaces the prompt input placeholder on the home screen. Items are used literally (no 'Ask anything...' prefix) and rotated.",
          ),
        shell: z
          .array(z.string())
          .optional()
          .describe(
            "Replaces the shell-mode prompt placeholder on the home screen. Items are used literally (no 'Run a command...' prefix) and rotated.",
          ),
      })
      .optional()
      .describe("Customize the rotating placeholder text shown inside the prompt input on the home screen."),
  })
  .extend(TuiOptions.shape)
  .strict()
