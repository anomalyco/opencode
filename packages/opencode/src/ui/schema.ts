import { z } from "zod"

export const SidebarSchema = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string().optional(),
  position: z.enum(["left", "right"]),
  defaultOpen: z.boolean().optional(),
  keybind: z.string().optional(),
})

export const TabSchema = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string().optional(),
  parent: z.string(),
})

export const PanelSchema = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string().optional(),
  area: z.enum(["top", "bottom", "left", "right"]),
  collapsible: z.boolean().optional(),
})

export const WidgetSchema = z.object({
  id: z.string(),
  label: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  size: z.object({
    width: z.number(),
    height: z.number(),
  }),
})

export const KeybindSchema = z.object({
  id: z.string(),
  keys: z.string(),
  command: z.string(),
  when: z.string().optional(),
})

export const StatusItemSchema = z.object({
  id: z.string(),
  priority: z.number(),
  alignment: z.enum(["left", "right"]),
})

export const CommandSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
})

export const UIExtensionsSchema = z.object({
  sidebars: z.array(SidebarSchema),
  tabs: z.array(TabSchema),
  panels: z.array(PanelSchema),
  widgets: z.array(WidgetSchema),
  keybinds: z.array(KeybindSchema),
  statusItems: z.array(StatusItemSchema),
  commands: z.array(CommandSchema),
})

export const UIRenderRequestSchema = z.object({
  componentId: z.string(),
  context: z.record(z.string(), z.any()).optional(),
})

export const UIRenderResponseSchema = z.object({
  content: z.string(),
  type: z.enum(["text", "markdown", "ansi", "html"]),
  error: z.string().optional(),
})
