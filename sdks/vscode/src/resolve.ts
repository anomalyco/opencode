export type Resolution = { action: "native"; port: number } | { action: "external"; port: number } | { action: "spawn" }

export interface TerminalInfo {
  port?: number
  active: boolean
}

export async function resolve(
  terminals: TerminalInfo[],
  workspace: string | undefined,
  discover: (path: string) => Promise<number | undefined>,
): Promise<Resolution> {
  const active = terminals.find((t) => t.active && t.port);
  if (active?.port) {return { action: "native", port: active.port };}

  const any = terminals.find((t) => t.port);
  if (any?.port) {return { action: "native", port: any.port };}

  if (workspace) {
    const port = await discover(workspace);
    if (port) {return { action: "external", port };}
  }

  return { action: "spawn" };
}
