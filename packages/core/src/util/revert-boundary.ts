export function boundaryFromMessageResponse<T extends { info?: { id?: string } }>(input: {
  data?: T
  error?: unknown
  response?: { status: number }
}) {
  if (input.response?.status === 404) return undefined
  if (input.error) throw input.error
  if (!input.data?.info?.id) throw new Error("missing revert boundary message")
  return input.data
}
