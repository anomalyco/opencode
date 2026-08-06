import { getFilename } from "@opencode-ai/core/util/path"

const APP_TITLE = "OpenCode"
const SEPARATOR = " - "
export const WINDOW_TITLE_MAX_LENGTH = 56

export function formatWindowTitle(directory?: string, tab?: string, maxLength = WINDOW_TITLE_MAX_LENGTH) {
  const directoryName = getFilename(directory) || directory
  if (!directoryName || !tab) return APP_TITLE

  const available = Math.max(2, maxLength - SEPARATOR.length)
  const directoryLength = Array.from(directoryName).length
  const tabLength = Array.from(tab).length
  if (directoryLength + tabLength <= available) return `${directoryName}${SEPARATOR}${tab}`

  const half = Math.floor(available / 2)
  const directoryBudget =
    directoryLength <= half ? directoryLength : tabLength <= available - half ? available - tabLength : half
  const tabBudget = available - directoryBudget
  return `${truncateMiddle(directoryName, directoryBudget)}${SEPARATOR}${truncateEnd(tab, tabBudget)}`
}

function truncateMiddle(value: string, maxLength: number) {
  const characters = Array.from(value)
  if (characters.length <= maxLength) return value
  if (maxLength <= 1) return "…"
  const available = maxLength - 1
  const start = Math.ceil(available / 2)
  const end = Math.floor(available / 2)
  return `${characters.slice(0, start).join("")}…${characters.slice(-end).join("")}`
}

function truncateEnd(value: string, maxLength: number) {
  const characters = Array.from(value)
  if (characters.length <= maxLength) return value
  if (maxLength <= 1) return "…"
  return `${characters.slice(0, maxLength - 1).join("")}…`
}
