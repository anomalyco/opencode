import path from "path"
import { $ } from "bun"

export namespace Upgrade {
  export async function method() {
    if (process.execPath.includes(path.join(".opencode", "bin"))) return "curl"

    // Use process.execPath as hint for which package manager to check first
    const execPath = process.execPath.toLowerCase()

    const checks = [
      {
        name: "npm" as const,
        command: () => $`npm list -g --depth=0`.throws(false).text(),
      },
      {
        name: "yarn" as const,
        command: () => $`yarn global list`.throws(false).text(),
      },
      {
        name: "pnpm" as const,
        command: () => $`pnpm list -g --depth=0`.throws(false).text(),
      },
      {
        name: "bun" as const,
        command: () => $`bun pm ls -g`.throws(false).text(),
      },
    ]

    // Sort by whether the name is in execPath (prioritize matching package manager)
    checks.sort((a, b) => {
      const aMatches = execPath.includes(a.name)
      const bMatches = execPath.includes(b.name)
      if (aMatches && !bMatches) return -1
      if (!aMatches && bMatches) return 1
      return 0
    })

    for (const check of checks) {
      const output = await check.command()
      if (output.includes("opencode-ai")) {
        return check.name
      }
    }

    return "unknown"
  }

  export async function latest() {
    return fetch("https://api.github.com/repos/sst/opencode/releases/latest")
      .then((res) => res.json())
      .then((data) => data.tag_name)
  }
}
