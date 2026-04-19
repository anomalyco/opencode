export function isSessionWorking(status?: { type?: string }) {
  return status?.type === "busy" || status?.type === "retry"
}
