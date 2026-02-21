const TOKEN = [
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /gh[opus]_[A-Za-z0-9]{20,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/gi,
  /x-access-token:[^\s"']+/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
]

const PARAM = [/(^|[?&])(token|access_token)=([^&\s]+)/gi]
const KEY = /(?:^|_)(TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|ACCESS_KEY|ID_TOKEN)(?:$|_)/i

function secure(line: string) {
  let out = line
  for (const re of TOKEN) out = out.replace(re, (m) => `${m.split(/\s+/)[0]} ***`)
  for (const re of PARAM) out = out.replace(re, (_m, p1, p2) => `${p1}${p2}=***`)
  return out
}

function hidden(key: string) {
  const value = key.toUpperCase()
  if (value.startsWith("GITHUB_")) return true
  if (value.startsWith("ACTIONS_")) return true
  return KEY.test(value)
}

export function sanitizeForGitHubOutput(input: string) {
  return input
    .split("\n")
    .map((line) => {
      const hit = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*[:=]\s*)(.*)$/)
      if (!hit) return secure(line)
      const [, pad, key, sep, value] = hit
      if (hidden(key)) return `${pad}${key}${sep}***`
      return `${pad}${key}${sep}${secure(value)}`
    })
    .join("\n")
}
