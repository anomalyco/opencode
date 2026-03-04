export const questionSubtitle = (count: number, t: (key: string) => string) => {
  if (count === 0) return ""
  return `${count} ${t(count > 1 ? "ui.common.question.other" : "ui.common.question.one")}`
}
