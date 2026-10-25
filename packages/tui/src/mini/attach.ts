// `run --attach` is overloaded: an http(s) URL attaches to a running bolt
// server (the historical behavior), anything else is a file or directory
// path injected into the prompt as context without being mentioned in the
// message text. The flag is repeatable; at most one server URL is allowed.
export interface Split {
  server?: string
  paths: string[]
  error?: string
}

export function split(values?: string | string[]): Split {
  const list = values === undefined ? [] : Array.isArray(values) ? values : [values]
  const servers = list.filter((value) => value.startsWith("http://") || value.startsWith("https://"))
  if (servers.length > 1) return { paths: [], error: "Pass at most one server URL to --attach" }
  return {
    server: servers[0],
    paths: list.filter((value) => !value.startsWith("http://") && !value.startsWith("https://")),
  }
}
