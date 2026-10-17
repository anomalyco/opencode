interface ContextMenuSuggestions {
  dictionarySuggestions?: string[]
}

export function normalizeContextMenuParams(params: ContextMenuSuggestions) {
  // Electron may omit suggestions outside spellcheck contexts; electron-context-menu assumes an array.
  if (!Array.isArray(params.dictionarySuggestions)) params.dictionarySuggestions = []
}
