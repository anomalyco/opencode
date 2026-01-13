import { SshError, SshErrorBucket } from "./types"

const ERROR_RULES: Array<{ bucket: SshErrorBucket; patterns: RegExp[] }> = [
  {
    bucket: "host-key-failure",
    patterns: [/host key verification failed/i, /offending .*key/i, /remote host identification has changed/i],
  },
  {
    bucket: "auth-failure",
    patterns: [/permission denied/i, /authentication failed/i, /too many authentication failures/i],
  },
  {
    bucket: "config-error",
    patterns: [/bad configuration option/i, /unknown option/i, /invalid configuration/i],
  },
  {
    bucket: "network-failure",
    patterns: [/could not resolve hostname/i, /no route to host/i, /connection timed out/i, /connection refused/i],
  },
  {
    bucket: "port-forward-failure",
    patterns: [/forwarding failed/i, /administratively prohibited/i, /cannot listen to port/i],
  },
]

function normalize(value?: string): string {
  return value?.trim().toLowerCase() ?? ""
}

function findBucket(text: string): SshErrorBucket {
  const match = ERROR_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(text)))
  if (match) {
    return match.bucket
  }
  return "unknown"
}

export function classifySshError(message: string, stderr?: string): SshError {
  const parts = [message, stderr].filter((value): value is string => Boolean(value))
  const text = normalize(parts.join("\n"))
  const bucket = findBucket(text)

  return {
    bucket,
    message,
    stderr,
  }
}
