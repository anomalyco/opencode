/** Clean markdown text for speech synthesis output */
export function cleanTextForSpeech(text: string): string {
  return (
    text
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, " code block ")
      // Remove inline code backticks but keep the text inside
      .replace(/`([^`]+)`/g, "$1")
      // Remove markdown headers
      .replace(/^#{1,6}\s+/gm, "")
      // Remove markdown bold/italic
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      // Remove markdown links but keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Remove HTML tags
      .replace(/<[^>]+>/g, "")
      // Remove excess whitespace
      .replace(/\s+/g, " ")
      .trim()
  )
}
