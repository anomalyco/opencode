type Env = Record<string, string | undefined>

export type RunOptions = {
  cwd?: string
  env?: Env
  throws?: boolean
}

export type SpawnHandle = {
  text(): Promise<string>
}

export function spawn(
  args: string[] = [],
  opts: RunOptions = {},
): SpawnHandle {
  const proc = Bun.spawn(args, {
    cwd: opts.cwd,
    env: opts.env ? { ...opts.env } : process.env,
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
