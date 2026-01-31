import type { 
  PreferenceRegistration, 
  PreferenceChange, 
  PreferenceValidation, 
  ValidationResult,
  PreferencesHook 
} from './types'

/**
 * In-memory registry for plugin preferences
 */
export class PreferenceRegistry {
  private static instance: PreferenceRegistry
  private preferences: Map<string, PreferenceRegistration> = new Map()
  private hooks: Map<string, PreferencesHook> = new Map()

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): PreferenceRegistry {
    if (!PreferenceRegistry.instance) {
      PreferenceRegistry.instance = new PreferenceRegistry()
    }
    return PreferenceRegistry.instance
  }

  /**
   * Register preferences from a plugin
   */
  async register(pluginId: string, hook: PreferencesHook, registration: PreferenceRegistration): Promise<void> {
    // Validate registration
    const { PreferenceRegistrationSchema } = await import('./types')
    const { z } = await import('zod')
    
    try {
      PreferenceRegistrationSchema.parse(registration)
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Invalid preference registration for plugin ${pluginId}: ${error.message}`)
      }
      throw error
    }

    // Store preference registration
    this.preferences.set(pluginId, registration)
    this.hooks.set(pluginId, hook)
    
    console.log(`Registered preferences for plugin: ${pluginId}`)
  }

  /**
   * Get all registered preference registrations
   */
  getAllRegistrations(): Map<string, PreferenceRegistration> {
    return new Map(this.preferences)
  }

  /**
   * Get specific plugin registration
   */
  getRegistration(pluginId: string): PreferenceRegistration | undefined {
    return this.preferences.get(pluginId)
  }

  /**
   * Handle preference value change
   */
  async handleChange(pluginId: string, key: string, value: any, oldValue?: any): Promise<void> {
    const hook = this.hooks.get(pluginId)
    const registration = this.preferences.get(pluginId)
    
    if (!hook || !registration) {
      throw new Error(`No preferences registered for plugin: ${pluginId}`)
    }

    // Call validation if provided
    if (hook.validate) {
      const validationResult = await hook.validate({
        key,
        value,
        registration
      })
      
      if (!validationResult.valid) {
        throw new Error(`Validation failed for ${key}: ${validationResult.error}`)
      }
      
      if (validationResult.warning) {
        console.warn(`Preference warning for ${key}: ${validationResult.warning}`)
      }
    }

    // Call change handler if provided
    if (hook.change) {
      await hook.change({
        key,
        value,
        oldValue,
        registration
      })
    }

    console.log(`Preference changed for plugin ${pluginId}: ${key} = ${value}`)
  }

  /**
   * Get current preference values for a plugin
   */
  async getValues(pluginId: string): Promise<Record<string, any>> {
    const hook = this.hooks.get(pluginId)
    const registration = this.preferences.get(pluginId)
    
    if (!registration) {
      return {}
    }

    // If plugin provides custom value getter, use it
    if (hook?.getValues) {
      return await hook.getValues()
    }

    // Otherwise, try to load from configuration (this will be implemented with Desktop integration)
    return registration.defaults
  }

  /**
   * Validate a preference value without changing it
   */
  async validateValue(pluginId: string, key: string, value: any): Promise<ValidationResult> {
    const hook = this.hooks.get(pluginId)
    const registration = this.preferences.get(pluginId)
    
    if (!hook || !registration) {
      return { valid: false, error: `No preferences registered for plugin: ${pluginId}` }
    }

    if (hook.validate) {
      return await hook.validate({
        key,
        value,
        registration
      })
    }

    // Default validation against schema
    return this.validateAgainstSchema(registration.schema[key], value)
  }

  /**
   * Basic schema validation
   */
  private validateAgainstSchema(fieldDef: any, value: any): ValidationResult {
    if (!fieldDef) {
      return { valid: false, error: 'Unknown preference key' }
    }

    const { type, validation = {} } = fieldDef

    // Type validation
    switch (type) {
      case 'string':
        if (typeof value !== 'string') {
          return { valid: false, error: 'Value must be a string' }
        }
        break
      case 'number':
        if (typeof value !== 'number') {
          return { valid: false, error: 'Value must be a number' }
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') {
          return { valid: false, error: 'Value must be a boolean' }
        }
        break
      case 'select':
      case 'multiselect':
        // Array values will be validated at Desktop level
        break
      case 'file':
      case 'directory':
        if (typeof value !== 'string') {
          return { valid: false, error: 'Value must be a file path string' }
        }
        break
    }

    // Apply validation rules
    if (validation.required && (value === undefined || value === null || value === '')) {
      return { valid: false, error: 'This field is required' }
    }

    if (typeof value === 'string') {
      if (validation.pattern && !new RegExp(validation.pattern).test(value)) {
        return { valid: false, error: 'Value does not match required pattern' }
      }
      if (validation.minLength && value.length < validation.minLength) {
        return { valid: false, error: `Value must be at least ${validation.minLength} characters` }
      }
      if (validation.maxLength && value.length > validation.maxLength) {
        return { valid: false, error: `Value must be no more than ${validation.maxLength} characters` }
      }
    }

    if (typeof value === 'number') {
      if (validation.min !== undefined && value < validation.min) {
        return { valid: false, error: `Value must be at least ${validation.min}` }
      }
      if (validation.max !== undefined && value > validation.max) {
        return { valid: false, error: `Value must be no more than ${validation.max}` }
      }
    }

    return { valid: true }
  }
}

/**
 * Global preference registry instance
 */
export const preferenceRegistry = PreferenceRegistry.getInstance()