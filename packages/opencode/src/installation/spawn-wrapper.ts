type Env = Record<string, string | undefined>

export type SpawnOptions = {
  cwd?: string
  env?: Env
  throws?: boolean
}

export type SpawnReturn = {
  text(): Promise<string>
}

export function spawnWrapper(
  args: string[] = [],
  opts: SpawnOptions = {},
): SpawnReturn {
  const env = opts.env ? opts.env : process.env

  const proc = Bun.spawn(args, {
    cwd: opts.cwd,
    env: env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  const text = async () => {
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    if (exitCode !== 0 && opts.throws !== false) {
      throw new Error(`Command failed (${exitCode}): ${args.join(" ")}\n${stderr}`)
    }

    return stdout
  }

  return {
    text,
  }
}
