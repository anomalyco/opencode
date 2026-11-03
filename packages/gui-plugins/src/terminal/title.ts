const template = "Terminal {{number}}"

// Default titles, including those of releases that created them in the interface language.
const numbered = [
  template,
  "محطة طرفية {{number}}",
  "Терминал {{number}}",
  "ターミナル {{number}}",
  "터미널 {{number}}",
  "เทอร์มินัล {{number}}",
  "终端 {{number}}",
  "終端機 {{number}}",
].map((text) => text.split("{{number}}"))

export function defaultTitle(number: number) {
  return template.replace("{{number}}", String(number))
}

/** The number of a default title such as "Terminal 2". */
export function titleNumber(title: string) {
  return numbered.flatMap(([before, after]) => {
    if (!title.startsWith(before) || !title.endsWith(after)) return []

    const digits = title.slice(before.length, title.length - after.length)

    return /^[1-9]\d*$/.test(digits) ? [Number(digits)] : []
  })[0]
}

/** A terminal's label: a default title in the interface language, else the server's title. */
export const terminalTabLabel = (input: {
  title?: string
  t: (key: string, vars?: Record<string, string | number | boolean>) => string
}) => {
  const title = input.title ?? ""
  const number = titleNumber(title)

  if (number !== undefined) return input.t("title.numbered", { number })

  return title || input.t("tab.title")
}
