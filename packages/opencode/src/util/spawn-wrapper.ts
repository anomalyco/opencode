type Env = Record<string, string | undefined>

export type SpawnOptions = {
  cwd?: string
  env?: Env
  throws?: boolean
  quiet?: boolean
}

export type SpawnReturn = {
  text(): Promise<string>
  exec(): Promise<{ exitCode: number; stdout: string; stderr: string }>
}

export function spawnWrapper(
  args: string[] = [],
  opts: SpawnOptions = {},
): SpawnReturn {
  const env = opts.env ? opts.env : process.env

  const text = async () => {
    opts.quiet = true
    const { stdout } = await exec()
    return stdout
  }

  const exec = async () => {
    const std_descriptor = opts.quiet ? "pipe" : "inherit";

    const proc = Bun.spawn(args, {
      cwd: opts.cwd,
      env: env,
      stdin: "ignore",
      stdout: std_descriptor,
      stderr: std_descriptor,
    })

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    if (exitCode !== 0 && opts.throws !== false) {
      throw new Error(`Command failed (${exitCode}): ${args.join(" ")}\n${stderr}`)
    }
    return { exitCode, stdout, stderr }
  }

  return {
    text,
    exec,
  }
}
