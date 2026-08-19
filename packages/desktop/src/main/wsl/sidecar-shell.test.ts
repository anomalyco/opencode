import { expect, test } from "bun:test"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { wslSidecarShell } from "./sidecar-shell"

test("loads interactive WSL environment variables for the desktop server", async () => {
  const home = await mkdtemp(join(tmpdir(), "opencode-wsl-env-"))
  const opencode = join(home, "opencode")
  await writeFile(join(home, ".profile"), 'source "$HOME/.bashrc"\n')
  await writeFile(join(home, ".bashrc"), "export COMPANY_BASEURL=https://company.example\n")
  await writeFile(opencode, '#!/usr/bin/env bash\nprintf "%s" "$COMPANY_BASEURL"\n')
  await chmod(opencode, 0o755)

  const shell = wslSidecarShell(opencode, 4096, "opencode", "secret", false)
  const proc = Bun.spawn(shell.args, {
    cwd: home,
    env: { ...process.env, HOME: home },
    stdin: new Blob([shell.script]),
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = await new Response(proc.stdout).text()
  await new Response(proc.stderr).text()
  const code = await proc.exited
  await rm(home, { recursive: true, force: true })

  expect({ code, output }).toEqual({ code: 0, output: "https://company.example" })
})
