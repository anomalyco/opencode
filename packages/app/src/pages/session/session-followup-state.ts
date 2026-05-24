export const shouldQueueFollowup = (input: {
  followup: "queue" | "steer"
  busy: boolean
  blocked: boolean
  child: boolean
}) => input.followup === "queue" && input.busy && !input.blocked && !input.child

export const shouldAutoSendFollowup = (input: {
  hasItem: boolean
  sending: boolean
  failed: boolean
  paused: boolean
  blocked: boolean
  busy: boolean
  child: boolean
}) =>
  input.hasItem && !input.sending && !input.failed && !input.paused && !input.blocked && !input.busy && !input.child
