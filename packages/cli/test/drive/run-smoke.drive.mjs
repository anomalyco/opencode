import { defineScript } from "opencode-drive"
import { mkdir } from "node:fs/promises"
import path from "node:path"

export default defineScript({
  launch: "manual",
  setup({ config }) {
    config.autoupdate = false
  },
  async run({ artifacts, llm, server }) {
    await configureServicePort(artifacts)
    llm.queue(llm.text("drive noninteractive smoke ok"))
    await server.launch()

    const registration = await serviceRegistration(artifacts)
    const root = path.resolve(import.meta.dir, "../../../..")
    const directory = path.join(artifacts, "files")
    const child = Bun.spawn(
      [
        process.execPath,
        path.join(root, "packages/cli/src/index.ts"),
        "run",
        "--server",
        registration.url,
        "drive smoke",
      ],
      {
        cwd: path.join(root, "packages/cli"),
        env: {
          ...process.env,
          PWD: directory,
          OPENCODE_PASSWORD: registration.password,
          OPENCODE_CONFIG_DIR: path.join(directory, ".opencode"),
          OPENCODE_DISABLE_AUTOUPDATE: "1",
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (exitCode !== 0) throw new Error(`run exited ${exitCode}: ${stderr}`)
    if (stdout !== "drive noninteractive smoke ok\n") throw new Error(`unexpected run output: ${stdout}`)
  },
})

/** @param {string} artifacts */
async function configureServicePort(artifacts) {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = probe.port
  await probe.stop(true)
  if (!port) throw new Error("Failed to allocate a Drive service port")
  const file = path.join(artifacts, "files/.opencode/service-local.json")
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, JSON.stringify({ port }))
}

/** @param {string} artifacts */
async function serviceRegistration(artifacts) {
  const directory = path.join(artifacts, "home/.local/state/opencode")
  for (let attempt = 0; attempt < 200; attempt++) {
    for (const name of ["service-local.json", "service.json"]) {
      const value = await Bun.file(path.join(directory, name))
        .json()
        .catch(() => undefined)
      if (isRegistration(value)) return value
    }
    await Bun.sleep(50)
  }
  throw new Error("Drive service registration was not written")
}

/** @param {unknown} value */
function isRegistration(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "url" in value &&
    typeof value.url === "string" &&
    "password" in value &&
    typeof value.password === "string"
  )
}
