import fs from "fs/promises"
import path from "path"
import { createHash } from "crypto"
import z from "zod"
import { Storage } from "../storage/storage"
import { Global } from "../global"

export namespace SshKey {
  const MANAGED_BEGIN = "# opencode:begin"
  const MANAGED_END = "# opencode:end"
  const KEY_DIR = "opencode"

  export const Input = z
    .object({
      name: z.string().trim().min(1),
      publicKey: z.string().trim().min(1),
      privateKey: z.string().trim().min(1),
      hosts: z.array(z.string().trim().min(1)).min(1),
    })
    .meta({
      ref: "SshKeyInput",
    })

  const InstallInfo = z
    .object({
      privateKeyPath: z.string(),
      publicKeyPath: z.string(),
      configPath: z.string(),
    })
    .meta({
      ref: "SshKeyInstallInfo",
    })

  const Stored = Input.extend({
    id: z.string(),
    fingerprint: z.string(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
    installed: InstallInfo.optional(),
  }).meta({
    ref: "SshKeyStored",
  })

  export const Info = Stored.omit({ privateKey: true }).meta({
    ref: "SshKey",
  })
  export type Info = z.infer<typeof Info>
  type Stored = z.infer<typeof Stored>
  type InstallInfo = z.infer<typeof InstallInfo>

  function resolveHome(home?: string) {
    const trimmed = home?.trim()
    if (trimmed) return trimmed
    return Global.Path.home
  }

  function normalizeHosts(hosts: string[]) {
    const normalized = hosts.map((host) => host.trim()).filter(Boolean)
    return Array.from(new Set(normalized))
  }

  function escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  function stripManagedBlock(contents: string) {
    const pattern = new RegExp(`${escapeRegex(MANAGED_BEGIN)}[\\s\\S]*?${escapeRegex(MANAGED_END)}\\n?`, "g")
    return contents.replace(pattern, "").trimEnd()
  }

  function fingerprintFromPublicKey(publicKey: string) {
    const parts = publicKey.trim().split(/\s+/)
    if (parts.length < 2) {
      throw new Error("Public key must include a key type and key data.")
    }
    const keyBody = parts[1]
    const decoded = Buffer.from(keyBody, "base64")
    if (!decoded.length) {
      throw new Error("Public key data is invalid.")
    }
    const digest = createHash("sha256").update(decoded).digest("base64")
    return `SHA256:${digest}`
  }

  async function ensureDir(dir: string, mode: number) {
    await fs.mkdir(dir, { recursive: true })
    await fs.chmod(dir, mode).catch(() => {})
  }

  function buildManagedBlock(records: Stored[]) {
    const entries = records
      .filter((record) => record.installed && record.hosts.length > 0)
      .map((record) => {
        const install = record.installed as InstallInfo
        return [
          `# opencode:key:${record.id} ${record.name}`,
          `Host ${record.hosts.join(" ")}`,
          `  IdentityFile ${install.privateKeyPath}`,
          "  IdentitiesOnly yes",
        ].join("\n")
      })

    if (entries.length === 0) return undefined

    return [MANAGED_BEGIN, "# Managed by OpenCode", entries.join("\n\n"), MANAGED_END].join("\n")
  }

  async function updateConfig(home: string, records: Stored[]) {
    const sshDir = path.join(home, ".ssh")
    await ensureDir(sshDir, 0o700)

    const configPath = path.join(sshDir, "config")
    const existing = await fs.readFile(configPath, "utf8").catch(() => "")
    const base = stripManagedBlock(existing)
    const managed = buildManagedBlock(records)

    let next = base
    if (managed) {
      next = base ? `${base}\n\n${managed}` : managed
    }
    if (next && !next.endsWith("\n")) {
      next += "\n"
    }

    if (next !== existing) {
      await fs.writeFile(configPath, next, { mode: 0o600 })
      await fs.chmod(configPath, 0o600).catch(() => {})
    }

    return configPath
  }

  async function listStored(username: string) {
    const keys = await Storage.list(["ssh-keys", username])
    const records: Stored[] = []
    for (const key of keys) {
      const record = await Storage.read<Stored>(key).catch(() => undefined)
      if (!record) continue
      const parsed = Stored.safeParse(record)
      if (parsed.success) records.push(parsed.data)
    }
    records.sort((a, b) => a.time.created - b.time.created)
    return records
  }

  function toInfo(record: Stored): Info {
    const { privateKey, ...rest } = record
    return rest
  }

  export async function list(username: string) {
    const records = await listStored(username)
    return records.map(toInfo)
  }

  export async function create(input: z.infer<typeof Input>, options: { username: string; home?: string }) {
    const parsed = Input.parse({
      ...input,
      hosts: normalizeHosts(input.hosts),
    })
    if (parsed.hosts.length === 0) {
      throw new Error("At least one host pattern is required.")
    }

    const id = crypto.randomUUID()
    const now = Date.now()
    const home = resolveHome(options.home)
    const fingerprint = fingerprintFromPublicKey(parsed.publicKey)

    const sshDir = path.join(home, ".ssh")
    const keyDir = path.join(sshDir, KEY_DIR)
    await ensureDir(sshDir, 0o700)
    await ensureDir(keyDir, 0o700)

    const privateKeyPath = path.join(keyDir, `opencode-${id}`)
    const publicKeyPath = path.join(keyDir, `opencode-${id}.pub`)
    await fs.writeFile(privateKeyPath, `${parsed.privateKey.trimEnd()}\n`, { mode: 0o600 })
    await fs.writeFile(publicKeyPath, `${parsed.publicKey.trimEnd()}\n`, { mode: 0o644 })
    await fs.chmod(privateKeyPath, 0o600).catch(() => {})
    await fs.chmod(publicKeyPath, 0o644).catch(() => {})

    const record: Stored = {
      ...parsed,
      id,
      fingerprint,
      time: {
        created: now,
        updated: now,
      },
      installed: {
        privateKeyPath,
        publicKeyPath,
        configPath: path.join(sshDir, "config"),
      },
    }

    await Storage.write(["ssh-keys", options.username, id], record)
    const records = await listStored(options.username)
    const configPath = await updateConfig(home, records)

    const updatedRecord: Stored = {
      ...record,
      installed: {
        ...record.installed!,
        configPath,
      },
    }
    await Storage.write(["ssh-keys", options.username, id], updatedRecord)
    return toInfo(updatedRecord)
  }

  export async function remove(keyId: string, options: { username: string; home?: string }) {
    const record = await Storage.read<Stored>(["ssh-keys", options.username, keyId])
    const home = resolveHome(options.home)

    if (record.installed?.privateKeyPath) {
      await fs.rm(record.installed.privateKeyPath, { force: true })
    }
    if (record.installed?.publicKeyPath) {
      await fs.rm(record.installed.publicKeyPath, { force: true })
    }

    await Storage.remove(["ssh-keys", options.username, keyId])
    const records = await listStored(options.username)
    await updateConfig(home, records)
    return true
  }
}
