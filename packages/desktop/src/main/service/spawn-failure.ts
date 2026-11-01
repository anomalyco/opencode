export * as SpawnFailure from "./spawn-failure"

// The client reports a contender that could not be spawned at all (the operating system refused to run the
// executable) as "Failed to start server" caused by the spawn error. A server that started and then exited,
// such as one that lost its port, is reported differently and must not trigger a second attempt.
export function is(error: unknown) {
  return error instanceof Error && error.message === "Failed to start server" && error.cause instanceof Error
}
