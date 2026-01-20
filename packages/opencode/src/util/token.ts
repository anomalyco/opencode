export namespace Token {
  const CHARS_PER_TOKEN = 4

  export function estimate(input: string) {
    return Math.max(0, Math.round((input || "").length / CHARS_PER_TOKEN))
  }

  export function estimateImage(urlOrData: string): number {
    // Estimate tokens for image data/URLs since providers don't return image token counts
    // Uses string length as proxy: data URLs contain base64 image data, file paths are small
    return Math.max(100, Math.round(urlOrData.length / 170))
  }
}
