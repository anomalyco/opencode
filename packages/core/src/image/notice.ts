export * as ImageNotice from "./notice.js"

import { SystemNotice } from "../session/system-notice.js"

/** The completion notice for a background image job, naming its job ID like shell notices do. */
export function text(input: { id: string; state: string; body: string }) {
  return SystemNotice.render(`Image job ${input.id} ${SystemNotice.outcome(input.state)}.`, {
    label: "Result",
    text: input.body,
  })
}
