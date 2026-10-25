import { Effect } from "effect"
import { mkdirSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import * as prompts from "@clack/prompts"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

function parseRemote(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/)
  if (!m) return null
  return { owner: m[1], repo: m[2] }
}

export default Runtime.handler(Commands.commands.github.commands.install, () =>
  Effect.promise(async () => {
    const cwd = process.cwd()
    let remoteUrl = ""
    try {
      remoteUrl = execSync("git remote get-url origin", { cwd, encoding: "utf8" }).trim()
    } catch {
      console.error("Could not find git repository. Please run this command from a git repository.")
      process.exitCode = 1
      return
    }
    const parsed = parseRemote(remoteUrl)
    if (!parsed) {
      console.error("Could not parse GitHub remote.")
      process.exitCode = 1
      return
    }

    prompts.intro("Install GitHub agent")

    const model = await prompts.text({
      message: "Model to use (provider/model)",
      placeholder: "anthropic/claude-sonnet-4-20250514",
      defaultValue: "anthropic/claude-sonnet-4-20250514",
    })
    if (prompts.isCancel(model)) {
      prompts.cancel("Installation cancelled")
      process.exitCode = 1
      return
    }

    const provider = (model as string).split("/")[0]
    const envVarMap: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      google: "GOOGLE_API_KEY",
      opencode: "OPENCODE_API_KEY",
      "github-copilot": "GITHUB_TOKEN",
    }
    const envVar = envVarMap[provider] ?? `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`

    const workflowDir = join(cwd, ".github", "workflows")
    if (!existsSync(workflowDir)) mkdirSync(workflowDir, { recursive: true })
    const workflowPath = join(workflowDir, "opencode.yml")
    const content = `name: opencode

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]

jobs:
  opencode:
    if: |
      contains(github.event.comment.body, ' /oc') ||
      startsWith(github.event.comment.body, '/oc') ||
      contains(github.event.comment.body, ' /opencode') ||
      startsWith(github.event.comment.body, '/opencode')
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
      pull-requests: write
      issues: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6
        with:
          persist-credentials: false

      - name: Run opencode
        uses: anomalyco/opencode/github@latest
        env:
          ${envVar}: \${{ secrets.${envVar} }}
        with:
          model: ${model}
`
    writeFileSync(workflowPath, content)
    prompts.log.success(`Added workflow file: "${workflowPath}"`)

    prompts.outro(
      [
        "Next steps:",
        "",
        `    1. Commit the workflow file and push`,
        `    2. Add ${envVar} as a repository secret`,
        "    3. Install the GitHub app: https://github.com/apps/opencode-agent",
        `    4. Comment '/oc' on an issue in ${parsed.owner}/${parsed.repo} to try it`,
      ].join("\n"),
    )
  }),
)
