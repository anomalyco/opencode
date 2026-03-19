import { Process } from "@/util/process"
import { git } from "@/util/git"

export async function pull(dir: string, branch?: string) {
  if (!branch || branch === "HEAD") return

  const remote = await git(["remote", "get-url", "origin"], { cwd: dir })
  if (remote.exitCode !== 0) return

  const host = parse(remote.text())
  if (!host) return
  if (host.includes("github")) return github(dir)
  if (host.includes("gitlab")) return gitlab(dir)
}

async function github(dir: string) {
  const out = await Process.text(["gh", "pr", "view", "--json", "url", "--jq", ".url"], {
    cwd: dir,
    nothrow: true,
    stdin: "ignore",
  })
  if (out.code !== 0) return

  const url = out.text.trim()
  if (!url) return
  return url
}

async function gitlab(dir: string) {
  const out = await Process.text(["glab", "mr", "view", "--json", "web_url"], {
    cwd: dir,
    nothrow: true,
    stdin: "ignore",
  })
  if (out.code !== 0 || !out.text.trim()) return

  const data = JSON.parse(out.text) as { web_url?: string }
  if (!data.web_url) return
  return data.web_url
}

function parse(input: string) {
  const text = input.trim().toLowerCase()
  if (!text) return

  if (text.startsWith("http://") || text.startsWith("https://") || text.startsWith("ssh://")) {
    const head = text
      .replace(/^https?:\/\//, "")
      .replace(/^ssh:\/\//, "")
      .split("/")[0]
    return head.split("@")[1] ?? head
  }

  const at = text.indexOf("@")
  const colon = text.indexOf(":")
  if (at === -1 || colon <= at) return
  return text.slice(at + 1, colon)
}
