type Message = {
  id: string
  role?: string
  parentID?: string
  time?: {
    created?: number
  }
}

function rank(message: Message) {
  if (message.role === "user") return 0
  if (message.role === "assistant") return 1
  return 2
}

export function compareMessages(a: Message, b: Message) {
  const at = a.time?.created ?? 0
  const bt = b.time?.created ?? 0
  if (at !== bt) return at - bt

  const ar = rank(a)
  const br = rank(b)
  if (ar !== br) return ar - br

  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

export function sortMessages<T extends Message>(messages: readonly T[]) {
  return messages.slice().sort(compareMessages)
}

export function selectAssistants<T extends Message>(messages: readonly T[], parentID: string) {
  return sortMessages(messages.filter((message) => message.role === "assistant" && message.parentID === parentID))
}

export function splitMessages<T extends Message>(messages: readonly T[], markerID?: string) {
  const sorted = sortMessages(messages)
  if (!markerID) return { before: sorted, after: [] as T[] }
  const index = sorted.findIndex((message) => message.id === markerID)
  if (index === -1) return { before: sorted, after: [] as T[] }
  return { before: sorted.slice(0, index), after: sorted.slice(index) }
}
