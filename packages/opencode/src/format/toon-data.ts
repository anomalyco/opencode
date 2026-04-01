import { encode, decode } from "@toon-format/toon"
import { Log } from "@/util/log"

export namespace TOONData {
  const log = Log.create({ service: "toon.data" })

  export interface SerializationResult {
    serialized: string
    originalSize: number
    serializedSize: number
    savingsPercentage: number
  }

  /**
   * Serialize structured data (objects, arrays) to TOON format
   * Uses the official @toon-format/toon library for data serialization
   *
   * TOON is optimal for:
   * - Uniform arrays of objects (CSV-like tables)
   * - Nested objects with consistent structure
   * - Large datasets with repeated patterns
   *
   * Not recommended for:
   * - Deeply nested irregular structures
   * - Small objects (overhead may not be worth it)
   * - Binary data
   */
  export function serialize(data: unknown): SerializationResult {
    const json = JSON.stringify(data)
    const originalSize = json.length

    const toon = encode(data)
    const serializedSize = toon.length

    const savingsPercentage = ((originalSize - serializedSize) / originalSize) * 100

    log.debug("toon.data.serialize", {
      originalSize,
      serializedSize,
      savingsPercentage: savingsPercentage.toFixed(2) + "%",
    })

    return {
      serialized: toon,
      originalSize,
      serializedSize,
      savingsPercentage,
    }
  }

  /**
   * Deserialize TOON format back to structured data
   * Lossless round-trip: data === parse(stringify(data))
   */
  export function deserialize(toon: string): unknown {
    return decode(toon)
  }

  /**
   * Check if data would benefit from TOON serialization
   * Returns true if estimated savings > 15%
   */
  export function shouldSerialize(data: unknown): boolean {
    const json = JSON.stringify(data)
    const toon = encode(data)

    const savings = ((json.length - toon.length) / json.length) * 100
    return savings > 15
  }

  /**
   * Estimate token savings for structured data
   * Uses rough approximation: 1 token ≈ 4 characters
   */
  export function estimateSavings(data: unknown): number {
    const json = JSON.stringify(data)
    const toon = encode(data)

    const jsonTokens = Math.ceil(json.length / 4)
    const toonTokens = Math.ceil(toon.length / 4)

    return jsonTokens - toonTokens
  }

  /**
   * Calculate savings percentage for structured data
   */
  export function calculateSavingsPercentage(data: unknown): number {
    const json = JSON.stringify(data)
    const jsonTokens = Math.ceil(json.length / 4)
    const savedTokens = estimateSavings(data)

    return jsonTokens > 0 ? (savedTokens / jsonTokens) * 100 : 0
  }
}
