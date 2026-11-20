export type NewSessionExtension = { id: string; name: string; status?: string }

export type NewSessionExtensionList = ReturnType<typeof createNewSessionExtensionList>

export function createNewSessionExtensionList(input: {
  entries: () => NewSessionExtension[]
  enabled: (entry: NewSessionExtension) => boolean
  toggle: (id: string, enabled: boolean) => void
  pending?: (id: string) => boolean
}) {
  return {
    items: () => input.entries().toSorted((a, b) => a.name.localeCompare(b.name)),
    enabled: input.enabled,
    toggle: input.toggle,
    count: () => input.entries().filter(input.enabled).length,
    pending: input.pending ?? (() => false),
  }
}
