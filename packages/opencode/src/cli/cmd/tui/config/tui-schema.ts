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
  voice: z
    .object({
      enabled: z.boolean().optional().describe("Enable voice input via local Whisper CLI"),
      whisper_command: z
        .array(z.string())
        .optional()
        .describe(
          "Whisper CLI args array. {audio} = recorded wav path, {language} = language code, {output_dir} = txt output dir. Defaults to ['whisper','{audio}','--language','{language}','--output_format','txt','--output_dir','{output_dir}'].",
        ),
      record_command: z
        .array(z.string())
        .optional()
        .describe(
          "Recorder args array. {output} = wav path, {max_seconds} = max duration. Platform defaults: macOS avfoundation, Linux pulse, Windows dshow (set this on Windows to match your mic device name).",
        ),
      language: z.string().optional().describe("Language code passed to Whisper (e.g. 'en', 'zh'). Defaults to 'auto'."),
      max_seconds: z.number().min(1).optional().describe("Max recording duration in seconds before auto-stop. Defaults to 60."),
    })
    .optional()
    .describe("Voice input configuration for the prompt"),
})

export const TuiInfo = z
  .object({
    $schema: z.string().optional(),
    theme: z.string().optional(),
    keybinds: KeybindOverride.optional(),
    plugin: ConfigPlugin.Spec.zod.array().optional(),
    plugin_enabled: z.record(z.string(), z.boolean()).optional(),
  })
  .extend(TuiOptions.shape)
  .strict()
