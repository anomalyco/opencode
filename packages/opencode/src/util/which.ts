import whichPkg from "which"

export function which(cmd: string, env?: NodeJS.ProcessEnv) {
  const result = whichPkg.sync(cmd, {
    nothrow: true,
    path: env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path,
    pathExt: env?.PATHEXT ?? process.env.PATHEXT,
  })
  return typeof result === "string" ? result : null
}
