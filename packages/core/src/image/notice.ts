export * as ImageNotice from "./notice.js"

import { BackgroundResult } from "../session/background-result.js"

/** The completion notice for a background image job, tagged with its job ID like `<background-result kind="shell" id=…>` notices. */
export function text(input: { id: string; state: string; body: string }) {
  return BackgroundResult.render(`kind="image" id="${input.id}" state="${input.state}"`, input.body)
}

/** The inline Markdown a reply uses to show a saved image. */
export function embed(file: string) {
  return `![](<${file}>)`
}
