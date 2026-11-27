export * as BackgroundResult from "./background-result.js"

export function render(attributes: string, body: string) {
  return `<background-result ${attributes}>\n${body}\n</background-result>`
}
