import z from "zod"

// ============================================================================
// Field Definitions (for form intent)
// ============================================================================

export const SelectOption = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
})

export const SelectField = z.object({
  type: z.literal("select"),
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  options: z.array(SelectOption).min(2).max(8),
  default: z.string().optional(),
})

export const MultiSelectField = z.object({
  type: z.literal("multiselect"),
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  options: z.array(SelectOption).min(2).max(8),
  default: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
})

export const TextField = z.object({
  type: z.literal("text"),
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  default: z.string().optional(),
  // Conditional display based on another field's value
  condition: z
    .object({
      field: z.string(),
      equals: z.string(),
    })
    .optional(),
})

export const ConfirmField = z.object({
  type: z.literal("confirm"),
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  default: z.boolean().optional(),
})

export const FormField = z.discriminatedUnion("type", [SelectField, MultiSelectField, TextField, ConfirmField])

export type FormField = z.infer<typeof FormField>
export type SelectField = z.infer<typeof SelectField>
export type MultiSelectField = z.infer<typeof MultiSelectField>
export type TextField = z.infer<typeof TextField>
export type ConfirmField = z.infer<typeof ConfirmField>
export type SelectOption = z.infer<typeof SelectOption>

// ============================================================================
// Intent Definitions
// ============================================================================

export const FormIntent = z.object({
  type: z.literal("form"),
  title: z.string(),
  description: z.string().optional(),
  fields: z.array(FormField).min(1).max(10),
  submitLabel: z.string().optional().default("Submit"),
  cancelLabel: z.string().optional().default("Cancel"),
})

export const ConfirmIntent = z.object({
  type: z.literal("confirm"),
  title: z.string(),
  message: z.string(),
  confirmLabel: z.string().optional().default("Yes"),
  cancelLabel: z.string().optional().default("No"),
  variant: z.enum(["info", "warning", "danger"]).optional().default("info"),
})

// Standalone select (for simple single-question use)
export const SelectIntent = z.object({
  type: z.literal("select"),
  title: z.string(),
  description: z.string().optional(),
  options: z.array(SelectOption).min(2).max(8),
  default: z.string().optional(),
})

// Standalone multiselect
export const MultiSelectIntent = z.object({
  type: z.literal("multiselect"),
  title: z.string(),
  description: z.string().optional(),
  options: z.array(SelectOption).min(2).max(8),
  default: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
})

// Toast (non-blocking notification)
export const ToastIntent = z.object({
  type: z.literal("toast"),
  message: z.string(),
  variant: z.enum(["info", "success", "warning", "error"]).optional().default("info"),
  duration: z.number().optional(),
})

// Note: progress primitive deferred to future PR - implementation unclear

export const Intent = z
  .discriminatedUnion("type", [FormIntent, ConfirmIntent, SelectIntent, MultiSelectIntent, ToastIntent])
  .meta({
    ref: "Intent",
  })

export type Intent = z.infer<typeof Intent>
export type FormIntent = z.infer<typeof FormIntent>
export type ConfirmIntent = z.infer<typeof ConfirmIntent>
export type SelectIntent = z.infer<typeof SelectIntent>
export type MultiSelectIntent = z.infer<typeof MultiSelectIntent>
export type ToastIntent = z.infer<typeof ToastIntent>

// ============================================================================
// Request & Response
// ============================================================================

export const IntentInfo = z
  .object({
    id: z.string(),
    sessionID: z.string(),
    messageID: z.string(),
    callID: z.string().optional(),
    source: z.enum(["core", "plugin"]),
    plugin: z.string().optional(),
    intent: Intent,
    time: z.object({
      created: z.number(),
    }),
  })
  .meta({
    ref: "IntentInfo",
  })

export type IntentInfo = z.infer<typeof IntentInfo>

export const IntentResponse = z.object({
  type: z.enum(["submit", "cancel"]),
  data: z.record(z.string(), z.any()).optional(),
})

export type IntentResponse = z.infer<typeof IntentResponse>
