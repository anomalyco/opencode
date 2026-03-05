export type ProjectOpenMode = "git" | "path"

const gitPattern = /^(https?:\/\/|ssh:\/\/|git@).+/i
const providerHost = {
  github: "github.com",
  gitlab: "gitlab.com",
} as const

function withGitSuffix(value: string) {
  if (value.endsWith(".git")) return value
  return `${value}.git`
}

export function parseProjectInput(value: string) {
  return value.trim()
}

export function isGitRepositoryUrl(value: string) {
  return gitPattern.test(parseProjectInput(value))
}

export function nextProjectOpenMode(mode: ProjectOpenMode) {
  if (mode === "git") return "path"
  return "git"
}

export function resolveCloneRepositoryUrl(value: string) {
  const input = parseProjectInput(value)
  if (!input) return ""
  if (isGitRepositoryUrl(input)) return input

  const provider = /^(github|gitlab):([a-z0-9._-]+(?:\/[a-z0-9._-]+)+)$/i.exec(input)
  if (provider) {
    const host = providerHost[provider[1].toLowerCase() as keyof typeof providerHost]
    return withGitSuffix(`https://${host}/${provider[2]}`)
  }

  const hostPath = /^([^\s/:]+(?:\.[^\s/:]+)+)\/([a-z0-9._-]+(?:\/[a-z0-9._-]+)+)$/i.exec(input)
  if (hostPath) {
    return withGitSuffix(`https://${hostPath[1]}/${hostPath[2]}`)
  }

  const short = /^([a-z0-9._-]+)\/([a-z0-9._-]+)$/i.exec(input)
  if (short) {
    return withGitSuffix(`https://github.com/${short[1]}/${short[2]}`)
  }

  return ""
}

export function cloneRepositoryName(value: string) {
  const url = resolveCloneRepositoryUrl(value)
  if (!url) return ""
  const parts = url.replace(/[\\/]+$/, "").split("/")
  const tail = parts.at(-1) ?? ""
  return tail.replace(/\.git$/i, "")
}

export function suggestCloneTargetPath(value: string, root: string) {
  const base = parseProjectInput(root)
  if (!base) return ""
  const name = cloneRepositoryName(value)
  if (!name) return base
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/"
  const trimmed = base.replace(/[\\/]+$/, "")
  return `${trimmed}${sep}${name}`
}

export function projectOpenError(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return "Unknown error"
}
