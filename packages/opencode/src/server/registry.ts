import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Global } from "../global"

export namespace ServerRegistry {
  export const ServerEntry = z.object({
    id: z.string(),
    url: z.string(),
    port: z.number(),
    pid: z.number(),
    lastHeartbeat: z.number(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  export type ServerEntry = z.infer<typeof ServerEntry>

  const filepath = path.join(Global.Path.data, "servers.json")
  const HEARTBEAT_TTL = 30_000 // 30 seconds

  export async function register(server: ServerEntry): Promise<void> {
    const servers = await all()
    servers[server.id] = server
    await write(servers)
  }

  export async function unregister(serverId: string): Promise<void> {
    const servers = await all()
    delete servers[serverId]
    await write(servers)
  }

  export async function list(): Promise<ServerEntry[]> {
    const servers = await all()
    return Object.values(servers)
  }

  export async function heartbeat(serverId: string): Promise<void> {
    const servers = await all()
    const server = servers[serverId]
    if (!server) return

    server.lastHeartbeat = Date.now()
    await write(servers)
  }

  export async function pruneStale(): Promise<void> {
    const servers = await all()
    const now = Date.now()
    const updated: Record<string, ServerEntry> = {}

    for (const [id, server] of Object.entries(servers)) {
      if (now - server.lastHeartbeat < HEARTBEAT_TTL) {
        updated[id] = server
      }
    }

    await write(updated)
  }

  async function all(): Promise<Record<string, ServerEntry>> {
    const file = Bun.file(filepath)
    return file.json().catch(() => ({}))
  }

  async function write(servers: Record<string, ServerEntry>): Promise<void> {
    // Atomic write: write to temp file, then rename
    const tempPath = filepath + ".tmp"
    await Bun.write(tempPath, JSON.stringify(servers, null, 2))
    await fs.rename(tempPath, filepath)
  }
}
