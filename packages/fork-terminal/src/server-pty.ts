import type { PtyInfo } from "./server"
import type { BrokerPtyManager } from "./broker-pty-manager"

type CreateInput = {
  command?: string
  args?: string[]
  cwd?: string
  title?: string
  env?: Record<string, string>
}

type BrokerCreateDeps = {
  brokerManager: BrokerPtyManager<PtyInfo>
  shellPreferred: () => string
  instanceDirectory: string
  log: {
    info(message?: any, extra?: Record<string, any>): void
  }
}

export async function createPtyViaBroker(
  input: CreateInput,
  sessionId: string,
  requestId: string | undefined,
  deps: BrokerCreateDeps,
): Promise<PtyInfo> {
  const command = input.command || deps.shellPreferred()
  const args = input.args ? [...input.args] : []
  if (command.endsWith("sh")) {
    args.push("-l")
  }
  const cwd = input.cwd || deps.instanceDirectory

  const brokerInfo = await deps.brokerManager.create(
    sessionId,
    {
      term: input.env?.TERM ?? "xterm-256color",
      cols: 80,
      rows: 24,
      env: input.env,
    },
    requestId,
  )

  const info: PtyInfo = {
    id: brokerInfo.ptyId,
    title: input.title || `Terminal ${brokerInfo.ptyId.slice(-4)}`,
    command,
    args,
    cwd,
    status: "running",
    pid: brokerInfo.pid,
  }

  deps.brokerManager.set(info)
  deps.log.info("broker PTY spawned", { sessionId, requestId, method: "spawnpty", ptyId: brokerInfo.ptyId, pid: brokerInfo.pid })

  return info
}
