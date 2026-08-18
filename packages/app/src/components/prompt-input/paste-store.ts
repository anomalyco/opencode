const key = "__opencode_paste_store"

function store(): Map<string, string> {
  return ((globalThis as Record<string, unknown>)[key] ??= new Map<string, string>()) as Map<string, string>
}

export function storePasteText(id: string, text: string) {
  store().set(id, text)
}

export async function storePasteTextFile(id: string, text: string): Promise<string> {
  store().set(id, text)
  const api = (globalThis as Record<string, unknown>).api as
    | { writePasteFile?: (id: string, text: string) => Promise<string> }
    | undefined
  if (api?.writePasteFile) {
    try {
      return await api.writePasteFile(id, text)
    } catch {
      return `.opencode/pastes/${id}.txt`
    }
  }
  return `.opencode/pastes/${id}.txt`
}

export function getPasteText(id: string): string | undefined {
  return store().get(id)
}

export function isPastePath(path: string): boolean {
  return path.startsWith(".opencode/pastes/") || path.includes("/pastes/") || path.includes("\\pastes\\")
}
