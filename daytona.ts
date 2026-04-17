import type { Daytona, Sandbox } from "@daytonaio/sdk"
import type { Plugin } from "@opencode-ai/plugin"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import { access, copyFile, mkdir } from "node:fs/promises"

let client: Promise<Daytona> | undefined

let daytona = function daytona(): Promise<Daytona> {
  if (client == null) {
    client = import("@daytonaio/sdk").then(
      ({ Daytona }) =>
        new Daytona({
          apiKey: "dtn_d63c206564ef49d4104ec2cd755e561bb3665beed8fd7d7ab2c5f7a2186965f0",
        }),
    )
  }
  return client
}

const preview = new Map<string, { url: string; token: string }>()
const repo = "/home/daytona/workspace/repo"
const root = "/home/daytona/workspace"
const localbin = "/home/daytona/opencode"
const installbin = "/home/daytona/.opencode/bin/opencode"
const health = "http://127.0.0.1:3096/global/health"

const local = fileURLToPath(
  new URL("./packages/opencode/dist/opencode-linux-x64-baseline/bin/opencode", import.meta.url),
)

async function exists(file: string) {
  return access(file)
    .then(() => true)
    .catch(() => false)
}

function sh(value: string) {
  return `'${value.replace(/'/g, `"'"'"`)}'`
}

// Internally Daytona uses axios, which tries to overwrite stack
// traces when a failure happens. That path fails in Bun, however, so
// when something goes wrong you only see a very obscure error.
async function withSandbox<T>(name: string, fn: (sandbox: Sandbox) => Promise<T>) {
  const stack = Error.captureStackTrace
  // @ts-expect-error temporary compatibility hack for Daytona's axios stack handling in Bun
  Error.captureStackTrace = undefined
  try {
    return await fn(await (await daytona()).get(name))
  } finally {
    Error.captureStackTrace = stack
  }
}

export const DaytonaWorkspacePlugin: Plugin = async ({ experimental_workspace, worktree, project }) => {
  experimental_workspace.register("daytona", {
    name: "Daytona",
    description: "Create a remote Daytona workspace",
    configure(config) {
      return config
    },
    async create(config, env) {
      const temp = join(tmpdir(), `opencode-daytona-${Date.now()}`)

      console.log("creating sandbox...")

      const sandbox = await (
        await daytona()
      ).create({
        name: config.name,
        snapshot: "daytona-large",
        envVars: env,
      })

      console.log("creating ssh...")

      const ssh = await withSandbox(config.name, (sandbox) => sandbox.createSshAccess())
      console.log("daytona:", ssh.sshCommand)

      const run = async (command: string) => {
        console.log("sandbox:", command)
        const result = await sandbox.process.executeCommand(command)
        if (result.result) process.stdout.write(result.result)
        if (result.exitCode === 0) return result
        throw new Error(result.result || `sandbox command failed: ${command}`)
      }

      const wait = async () => {
        for (let i = 0; i < 60; i++) {
          const result = await sandbox.process.executeCommand(`curl -fsS ${sh(health)}`)
          if (result.exitCode === 0) {
            if (result.result) process.stdout.write(result.result)
            return
          }
          console.log(`waiting for server (${i + 1}/60)`)
          await Bun.sleep(1000)
        }

        const log = await sandbox.process.executeCommand(`test -f /tmp/opencode.log && cat /tmp/opencode.log || true`)
        throw new Error(log.result || "daytona workspace server did not become ready in time")
      }

      const dir = join(temp, "repo")
      const tar = join(temp, "repo.tgz")
      const source = `file://${worktree}`
      await mkdir(temp, { recursive: true })
      const args = ["clone", "--depth", "1", "--no-local"]
      if (config.branch) args.push("--branch", config.branch)
      args.push(source, dir)

      console.log("git cloning...")

      const clone = Bun.spawn(["git", ...args], {
        cwd: tmpdir(),
        stdout: "pipe",
        stderr: "pipe",
      })
      const code = await clone.exited
      if (code !== 0) throw new Error(await new Response(clone.stderr).text())

      const configPackage = join(worktree, ".opencode", "package.json")
      // if (await exists(configPackage)) {
      //   console.log("copying config package...")
      //   await mkdir(join(dir, ".opencode"), { recursive: true })
      //   await copyFile(configPackage, join(dir, ".opencode", "package.json"))
      // }

      console.log("tarring...")

      const packed = Bun.spawn(["tar", "-czf", tar, "-C", temp, "repo"], {
        stdout: "ignore",
        stderr: "pipe",
      })
      if ((await packed.exited) !== 0) throw new Error(await new Response(packed.stderr).text())

      console.log("uploading files...")

      await sandbox.fs.uploadFile(tar, "repo.tgz")

      const have = await exists(local)
      console.log("local", local)
      if (have) {
        console.log("uploading local binary...")
        await sandbox.fs.uploadFile(local, "opencode")
      }

      console.log("bootstrapping workspace...")
      await run(`rm -rf ${sh(repo)} && mkdir -p ${sh(root)} && tar -xzf \"$HOME/repo.tgz\" -C \"$HOME/workspace\"`)

      if (have) {
        await run(`chmod +x ${sh(localbin)}`)
      } else {
        await run(
          `mkdir -p \"$HOME/.opencode/bin\" && OPENCODE_INSTALL_DIR=\"$HOME/.opencode/bin\" curl -fsSL https://opencode.ai/install | bash`,
        )
      }

      await run(`printf \"%s\\n\" ${sh(project.id)} > ${sh(`${repo}/.git/opencode`)}`)

      console.log("starting server...")
      await run(
        `cd ${sh(repo)} && exe=${sh(localbin)} && if [ ! -x \"$exe\" ]; then exe=${sh(installbin)}; fi && nohup env \"$exe\" serve --hostname 0.0.0.0 --port 3096 >/tmp/opencode.log 2>&1 </dev/null &`,
      )

      console.log("waiting for server...")
      await wait()
    },
    async remove(config) {
      const sandbox = await (await daytona()).get(config.name).catch(() => undefined)
      if (!sandbox) return
      await (await daytona()).delete(sandbox)
      preview.delete(config.name)
    },
    async target(config) {
      let link = preview.get(config.name)
      if (!link) {
        link = await withSandbox(config.name, (sandbox) => sandbox.getPreviewLink(3096))
        preview.set(config.name, link)
      }
      return {
        type: "remote",
        url: link.url,
        headers: {
          "x-daytona-preview-token": link.token,
          "x-daytona-skip-preview-warning": "true",
          "x-opencode-directory": repo,
        },
      }
    },
  })

  return {}
}

export default DaytonaWorkspacePlugin
