import { z } from "zod"

/**
 * Schema for defining preference fields
 */
export interface PreferenceSchema {
  [key: string]: {
    type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect' | 'file' | 'directory'
    description?: string
    default?: any
    validation?: ValidationRule
    options?: Array<{label: string; value: any}>  // For select types
    provider?: string                             // Dynamic options from providers
    help?: string                                  // Help text for users
  }
}

/**
 * Validation rules for preference values
 */
export interface ValidationRule {
  required?: boolean
  pattern?: string    // Regex pattern for string validation
  min?: number        // Minimum value for numbers
  max?: number        // Maximum value for numbers
  minLength?: number // Minimum length for strings
  maxLength?: number // Maximum length for strings
  custom?: (value: any) => string | undefined  // Custom validation function
}

/**
 * Preference registration input
 */
export interface PreferenceRegistration {
  id: string                    // Unique identifier for this preference set
  title: string                 // Display name for the tab/window
  icon?: string                 // Icon for the preference entry
  requiresRestart?: boolean     // Whether changes require restart
  schema: PreferenceSchema       // Preference schema definition
  defaults: Record<string, any>  // Default values
  ui?: UIPreferences            // UI hints for rendering
}

/**
 * UI hints for preference rendering
 */
export interface UIPreferences {
  group?: string     // Group preferences together (e.g., "Models", "Integrations")
  order?: number     // Display order within settings
  width?: 'normal' | 'wide' | 'full'  // Preferred width
}

/**
 * Preference change event
 */
export interface PreferenceChange {
  key: string
  value: any
  oldValue?: any
  registration: PreferenceRegistration
}

/**
 * Preference validation input
 */
export interface PreferenceValidation {
  key: string
  value: any
  registration: PreferenceRegistration
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean
  error?: string
  warning?: string
}

/**
 * Plugin preferences hook
 */
export interface PreferencesHook {
  // Register a preference tab
  register: (input: PreferenceRegistration) => Promise<PreferenceRegistration>
  
  // Handle preference changes
  change?: (input: PreferenceChange) => Promise<void>
  
  // Validate preference values
  validate?: (input: PreferenceValidation) => Promise<ValidationResult>
  
  // Get current preference values (optional, defaults to schema defaults)
  getValues?: () => Promise<Record<string, any>>
}

/**
 * Zod schemas for validation
 */
export const PreferenceRegistrationSchema = z.object({
  id: z.string(),
  title: z.string(),
  icon: z.string().optional(),
  requiresRestart: z.boolean().default(false),
  schema: z.record(z.object({
    type: z.enum(['string', 'number', 'boolean', 'select', 'multiselect', 'file', 'directory']),
    description: z.string().optional(),
    default: z.any().optional(),
    validation: z.object({
      required: z.boolean().optional(),
      pattern: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
      custom: z.function().optional(),
    }).optional(),
    options: z.array(z.object({
      label: z.string(),
      value: z.any(),
    })).optional(),
    provider: z.string().optional(),
    help: z.string().optional(),
  })),
  defaults: z.record(z.any()),
  ui: z.object({
    group: z.string().optional(),
    order: z.number().optional(),
    width: z.enum(['normal', 'wide', 'full']).optional(),
  }).optional(),
})

export const PreferenceChangeSchema = z.object({
  key: z.string(),
  value: z.any(),
  oldValue: z.any().optional(),
  registration: PreferenceRegistrationSchema,
})

export const PreferenceValidationSchema = z.object({
  key: z.string(),
  value: z.any(),
  registration: PreferenceRegistrationSchema,
})

export const ValidationResultSchema = z.object({
  valid: z.boolean(),
  error: z.string().optional(),
  warning: z.string().optional(),
})