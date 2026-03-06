import whichPkg from "which"

export function which(cmd: string, env?: NodeJS.ProcessEnv) {
  const result = whichPkg.sync(cmd, {
    nothrow: true,
    path: env?.PATH,
    pathExt: env?.PATHEXT,
  })
  return typeof result === "string" ? result : null
}
