import { getFilename } from "@opencode-ai/core/util/path"

const APP_TITLE = "OpenCode"
const SEPARATOR = " — "
export const WINDOW_TITLE_MAX_LENGTH = 56

export function formatWindowTitle(tab?: string, directory?: string, maxLength = WINDOW_TITLE_MAX_LENGTH) {
  const directoryName = getFilename(directory) || directory
  if (!directoryName || !tab) return APP_TITLE

  const limit = Math.max(0, Math.floor(maxLength))
  const directoryLength = Array.from(directoryName).length
  const tabLength = Array.from(tab).length
  if (directoryLength + tabLength + SEPARATOR.length <= limit) return `${tab}${SEPARATOR}${directoryName}`
  if (limit === 0) return ""
  if (limit < SEPARATOR.length + 2) return truncateEnd(tab, limit)

  const available = limit - SEPARATOR.length
  const directoryMax = Math.max(1, directoryLength - 1)
  const tabMax = Math.max(1, tabLength - 1)
  const tabBudget = Math.min(tabMax, Math.max(Math.ceil(available / 2), available - directoryMax))
  const directoryBudget = Math.min(directoryMax, available - tabBudget)
  return `${truncateEnd(tab, tabBudget)}${SEPARATOR}${truncateMiddle(directoryName, directoryBudget)}`
}

function truncateMiddle(value: string, maxLength: number) {
  const characters = Array.from(value)
  if (characters.length <= maxLength) return value
  if (maxLength <= 1) return "…"
  const available = maxLength - 1
  const start = Math.ceil(available / 2)
  const end = Math.floor(available / 2)
  return `${characters.slice(0, start).join("")}…${characters.slice(characters.length - end).join("")}`
}

function truncateEnd(value: string, maxLength: number) {
  const characters = Array.from(value)
  if (characters.length <= maxLength) return value
  if (maxLength <= 1) return "…"
  return `${characters.slice(0, maxLength - 1).join("")}…`
}
