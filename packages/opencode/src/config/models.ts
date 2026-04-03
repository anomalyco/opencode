/**
 * Model-specific adapter configuration.
 * Maps model name patterns to preferred adapter types.
 */
export namespace AdapterConfig {
  export type AdapterType = "qwen" | "gpt-oss" | "llama" | "glm" | "gemma" | "generic"

  const MODEL_MAP: Record<string, AdapterType> = {
    qwen: "qwen",
    "gpt-oss": "gpt-oss",
    llama: "llama",
    glm: "glm",
    gemma: "gemma",
  }

  /**
   * Determine the preferred adapter type for a given model name.
   * Returns "generic" if no specific match is found.
   */
  export function getAdapterType(modelName: string): AdapterType {
    const lower = modelName.toLowerCase()

    for (const [pattern, type] of Object.entries(MODEL_MAP)) {
      if (lower.includes(pattern)) return type
    }

    // Llama thinking models need special handling
    if (lower.includes("thinking")) return "llama"

    return "generic"
  }
}
