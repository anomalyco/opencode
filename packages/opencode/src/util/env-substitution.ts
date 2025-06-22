/**
 * Utility functions for environment variable substitution
 */

/**
 * Substitutes environment variables in a string.
 * Supports patterns like:
 * - $VAR_NAME
 * - ${VAR_NAME}
 * - ${VAR_NAME:-default_value}
 * 
 * @param value - The string value that may contain environment variable references
 * @returns The string with environment variables substituted
 */
export function substituteEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}|\$([A-Z_][A-Z0-9_]*)/gi, (_, braced, unbraced) => {
    const varSpec = braced || unbraced
    
    // Handle default values: ${VAR_NAME:-default}
    if (varSpec.includes(':-')) {
      const [varName, defaultValue] = varSpec.split(':-', 2)
      return process.env[varName] ?? defaultValue
    }
    
    // Simple variable reference
    const envValue = process.env[varSpec]
    if (envValue === undefined) {
      throw new Error(`Environment variable '${varSpec}' is not defined`)
    }
    
    return envValue
  })
}

/**
 * Substitutes environment variables in all string values of an object recursively.
 * 
 * @param obj - The object to process
 * @returns A new object with environment variables substituted
 */
export function substituteEnvVarsInObject<T>(obj: T): T {
  if (typeof obj === 'string') {
    return substituteEnvVars(obj) as T
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => substituteEnvVarsInObject(item)) as T
  }
  
  if (obj && typeof obj === 'object') {
    const result: any = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVarsInObject(value)
    }
    return result as T
  }
  
  return obj
}

/**
 * Safely substitutes environment variables in headers object.
 * Returns undefined if headers is undefined.
 * 
 * @param headers - The headers object that may contain env var references
 * @returns Headers object with environment variables substituted
 */
export function substituteEnvVarsInHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) {
    return undefined
  }
  
  return substituteEnvVarsInObject(headers)
}