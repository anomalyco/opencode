// Builds and deploys the data site's Workers: the OG Worker first, since the site binds to it, then the sync Worker,
// then the site. --secrets-file is a JSON object of secret values (the deploy job writes it from AWS Secrets Manager);
// each Worker gets only the secrets its config declares, through a file in the same directory removed afterwards.
//
//   bun script/deploy.ts --mode dev|production [--secrets-file <path>]
import { rm } from "node:fs/promises"
import path from "node:path"
import { resolveAndParseConfig } from "@cloudflare/config"
import { stage } from "../stage"

const root = path.resolve(import.meta.dir, "..")
const flag = (name: string) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}
const mode = stage(flag("--mode"))
const secretsFile = flag("--secrets-file")
const secrets: Record<string, string> = secretsFile ? await Bun.file(secretsFile).json() : {}

await Bun.$`bun script/build.ts --mode ${mode}`.cwd(root)

for (const [directory, file] of [
  ["og", "../og.config"],
  ["sync", "../sync.config"],
  ["default", "../cloudflare.config"],
] as const) {
  const parsed = await resolveAndParseConfig((await import(file)).default, { isPreview: false, mode })
  if (!parsed.success) throw new Error(`${file}: ${parsed.error.message}`)
  const names = Object.entries(parsed.data.worker?.env ?? {})
    .filter(([, binding]) => binding.type === "secret")
    .map(([name]) => name)
  const missing = names.filter((name) => !secrets[name])
  if (secretsFile && missing.length) throw new Error(`${file}: missing secrets ${missing.join(", ")}`)
  const name = parsed.data.worker?.name
  if (!name) throw new Error(`${file} defines no worker`)
  const args = ["--prebuilt", "--mode", mode, "--worker", name]
  const scoped = secretsFile && names.length ? `${secretsFile}.${directory}` : undefined
  if (scoped) {
    await Bun.write(scoped, JSON.stringify(Object.fromEntries(names.map((name) => [name, secrets[name]]))), {
      mode: 0o600,
    })
    args.push("--secrets-file", scoped)
  }
  try {
    await Bun.$`cf deploy ${args}`.cwd(root)
  } finally {
    if (scoped) await rm(scoped, { force: true })
  }
}
