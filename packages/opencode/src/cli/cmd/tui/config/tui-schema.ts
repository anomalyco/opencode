import z from "zod"
import { ConfigPlugin } from "@/config/plugin"
import { TuiKeybind } from "./keybind"

export const KeymapLeaderTimeoutDefault = 2000
const KeymapLeaderTimeout = z.number().int().positive().describe("Leader key timeout in milliseconds")

export const TuiOptions = z.object({
  leader_timeout: KeymapLeaderTimeout.optional(),
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
  session_bar: z.object({
    context: z.boolean().default(true).describe("Show context usage in session bar"),
    cost: z.boolean().default(true).describe("Show cost in session bar"),
  }).optional().describe("Session bar settings"),
  sidebar: z.object({
    context: z.boolean().default(true).describe("Show context usage in sidebar"),
    cost: z.boolean().default(true).describe("Show cost in sidebar"),
  }).optional().describe("Sidebar settings"),
})

export const TuiInfo = z
  .object({
    $schema: z.string().optional(),
    theme: z.string().optional(),
    keybinds: TuiKeybind.KeybindOverrides.optional(),
    plugin: ConfigPlugin.Spec.zod.array().optional(),
    plugin_enabled: z.record(z.string(), z.boolean()).optional(),
  })
  .extend(TuiOptions.shape)
  .strict()

export const TuiJsonSchemaInfo = TuiInfo
