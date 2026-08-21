import { isDefaultTitle } from "@/context/terminal-title"

export const terminalTabLabel = (input: {
  title?: string
  titleNumber?: number
  t: (key: string, vars?: Record<string, string | number | boolean>) => string
}) => {
  const title = input.title ?? ""
  const number = input.titleNumber ?? 0
  const defaultTitle = Number.isFinite(number) && number > 0 && isDefaultTitle(title, number)

  if (title && !defaultTitle) return title
  if (number > 0) return input.t("terminal.title.numbered", { number })
  if (title) return title
  return input.t("terminal.title")
}
