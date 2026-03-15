type Part = {
  type: string
  text?: string
}

export function filled(parts: Part[]) {
  return parts.some((part) => {
    if (part.type !== "text") return true
    return !!part.text?.trim()
  })
}
