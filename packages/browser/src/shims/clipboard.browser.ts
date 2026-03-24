// Browser clipboard using navigator.clipboard API
export async function write(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Fallback: some browsers restrict clipboard in non-secure contexts
    console.warn("Clipboard write failed - may require HTTPS or user interaction")
  }
}

export async function read(): Promise<string> {
  try {
    return await navigator.clipboard.readText()
  } catch {
    return ""
  }
}

export default { write, read }
