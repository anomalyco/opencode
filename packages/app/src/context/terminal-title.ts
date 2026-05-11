const template = "Terminal {{number}}"

const numbered = [
  template,
  "محطة طرفية {{number}}",
  "Терминал {{number}}",
  "ターミナル {{number}}",
  "터미널 {{number}}",
  "เทอร์มินัล {{number}}",
  "终端 {{number}}",
  "終端機 {{number}}",
]

export function defaultTitle(number: number) {
  return template.replace("{{number}}", String(number))
}

export function isDefaultTitle(title: string, number: number) {
  return numbered.some((text) => title === text.replace("{{number}}", String(number)))
}

export function titleNumber(title: string, max: number) {
  return Array.from({ length: max }, (_, idx) => idx + 1).find((number) => isDefaultTitle(title, number))
}
