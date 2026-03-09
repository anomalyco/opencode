import whichPkg from "which"

export function which(cmd: string, env?: NodeJS.ProcessEnv) {
  const path = env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path
  const pathExt = env?.PATHEXT ?? env?.PathExt ?? process.env.PATHEXT ?? process.env.PathExt
  const result = whichPkg.sync(cmd, {
    nothrow: true,
    path,
    pathExt,
  })
  return typeof result === "string" ? result : null
}
