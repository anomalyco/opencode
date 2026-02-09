export const terminalTabLabel = (input: {
  title?: string
  titleNumber?: number
  t: (key: string, vars?: Record<string, string | number | boolean>) => string
}) => {
  const title = input.title ?? ""
  const number = input.titleNumber ?? 0
  const match = title.match(/^Terminal (\d+)$/)
  const parsed = match ? Number(match[1]) : undefined
  const isDefaultTitle = Number.isFinite(number) && number > 0 && Number.isFinite(parsed) && parsed === number

  if (title && !isDefaultTitle) return title
  if (number > 0) return input.t("terminal.title.numbered", { number })
  if (title) return title
  return input.t("terminal.title")
}
