export function eager(args: { continue?: boolean; transport?: "local" | "attach" }) {
  const extra = args.transport !== "attach"
  return {
    session: Boolean(args.continue || extra),
    command: extra,
    resource: extra,
    workspace: extra,
  }
}
