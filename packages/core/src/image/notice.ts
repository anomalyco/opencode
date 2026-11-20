export * as ImageNotice from "./notice.js"

import { BackgroundResult } from "../session/background-result.js"

/** The completion notice for a background image job, naming its job ID like shell notices do. */
export function text(input: { id: string; state: string; body: string }) {
  return BackgroundResult.render("image", `Image job ${input.id} ${BackgroundResult.outcome(input.state)}.`, {
    label: "Result",
    text: input.body,
  })
}
