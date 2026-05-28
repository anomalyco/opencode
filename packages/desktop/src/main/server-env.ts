import { join, resolve } from "node:path"

export function sidecarDefaultCwd(userDataPath: string) {
  return join(resolve(userDataPath), "default-workspace")
}

export function createSidecarEnv(input: { cwd: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform }) {
  const source = input.env ?? process.env
  const env = Object.fromEntries(
    Object.entries(source).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]])),
  )
  delete env.DEBUG
  if ((input.platform ?? process.platform) === "linux") delete env.LD_PRELOAD
  env.PWD = input.cwd
  return env
}
