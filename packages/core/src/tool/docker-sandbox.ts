export * as DockerSandbox from "./docker-sandbox"

export interface Input {
  readonly command: string
  readonly cwd: string
  readonly image: string
}

export function command(input: Input): readonly [string, string[]] {
  const uid = process.getuid?.() ?? 1_000
  const gid = process.getgid?.() ?? 1_000
  return [
    "docker",
    [
      "run",
      "--rm",
      "--init",
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      "256",
      "--memory",
      "2g",
      "--cpus",
      "2",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=256m",
      "--user",
      `${uid}:${gid}`,
      "--env",
      "HOME=/tmp/home",
      "--volume",
      `${input.cwd}:/workspace:rw`,
      "--workdir",
      "/workspace",
      input.image,
      "/bin/sh",
      "-lc",
      input.command,
    ],
  ]
}

/**
 * The Docker client runs on the host, so it must not inherit credentials or
 * endpoint overrides such as DOCKER_HOST from the agent process.
 */
export function environment() {
  return {
    PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: "/tmp",
  }
}
