export * as ImageNotice from "./notice.js"

/** The completion notice for a background image job, tagged with its job ID like `<shell id=…>` notices. */
export function text(input: { id: string; state: string; body: string }) {
  return `<image id="${input.id}" state="${input.state}">\n${input.body}\n</image>`
}
