import { $ } from "bun"
import path from "path"
import { exec } from "child_process"
import * as prompts from "@clack/prompts"
import { map, pipe, sortBy, values } from "remeda"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { ModelsDev } from "../../provider/models"
import { App } from "../../app/app"

const WORKFLOW_FILE = ".github/workflows/opencode.yml"

export const InstallGithubCommand = cmd({
  command: "install-github",
  describe: "install the GitHub agent",
  async handler() {
    await App.provide({ cwd: process.cwd() }, async () => {
      UI.empty()
      prompts.intro("Install GitHub agent")
      const app = await getAppInfo()
      await installGitHubApp()

      const providers = await ModelsDev.get()
      const provider = await promptProvider()
      const model = await promptModel()
      //const key = await promptKey()

      await addWorkflowFiles()
      printNextSteps()

      function printNextSteps() {
        let step2
        if (provider === "amazon-bedrock") {
          step2 =
            "Configure OIDC in AWS - https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services"
        } else {
          const url = `https://github.com/organizations/${app.owner}/settings/secrets/actions`
          const env = providers[provider].env
          const envStr =
            env.length === 1
              ? `\`${env[0]}\` secret`
              : `\`${[env.slice(0, -1).join("\`, \`"), ...env.slice(-1)].join("\` and \`")}\` secrets`
          step2 = `Add ${envStr} for ${providers[provider].name} - ${url}`
        }

        prompts.outro(
          [
            "Next steps:",
            `    1. Commit "${WORKFLOW_FILE}" file and push`,
            `    2. ${step2}`,
            "    3. Learn how to use the GitHub agent - https://docs.opencode.ai/docs/github/getting-started",
          ].join("\n"),
        )
      }

      async function getAppInfo() {
        const app = App.info()
        if (!app.git) {
          prompts.log.error(`Could not find git repository. Please run this command from a git repository.`)
          throw new UI.CancelledError()
        }

        // Get repo info
        const info = await $`git remote get-url origin`.quiet().nothrow().text()
        // match https or git pattern
        // ie. https://github.com/sst/opencode.git
        // ie. git@github.com:sst/opencode.git
        const parsed = info.match(/git@github\.com:(.*)\.git/) ?? info.match(/github\.com\/(.*)\.git/)
        if (!parsed) {
          prompts.log.error(`Could not find git repository. Please run this command from a git repository.`)
          throw new UI.CancelledError()
        }
        const [owner, repo] = parsed[1].split("/")
        return { owner, repo, root: app.path.root }
      }

      async function promptProvider() {
        const priority: Record<string, number> = {
          anthropic: 0,
          "github-copilot": 1,
          openai: 2,
          google: 3,
        }
        let provider = await prompts.select({
          message: "Select provider",
          maxItems: 8,
          options: pipe(
            providers,
            values(),
            sortBy(
              (x) => priority[x.id] ?? 99,
              (x) => x.name ?? x.id,
            ),
            map((x) => ({
              label: x.name,
              value: x.id,
              hint: priority[x.id] === 0 ? "recommended" : undefined,
            })),
          ),
        })

        if (prompts.isCancel(provider)) throw new UI.CancelledError()

        return provider
      }

      async function promptModel() {
        const providerData = providers[provider]!

        const model = await prompts.select({
          message: "Select model",
          maxItems: 8,
          options: pipe(
            providerData.models,
            values(),
            sortBy((x) => x.name ?? x.id),
            map((x) => ({
              label: x.name ?? x.id,
              value: x.id,
            })),
          ),
        })

        if (prompts.isCancel(model)) throw new UI.CancelledError()
        return model
      }

      async function installGitHubApp() {
        const s = prompts.spinner()
        s.start("Installing GitHub app")

        // Get installation
        const installation = await getInstallation()
        if (installation) return s.stop("GitHub app already installed")

        // Open browser
        const url = "https://github.com/apps/opencode-agent"
        const command =
          process.platform === "darwin"
            ? `open "${url}"`
            : process.platform === "win32"
              ? `start "${url}"`
              : `xdg-open "${url}"`

        exec(command, (error) => {
          if (error) {
            prompts.log.warn(`Could not open browser. Please visit: ${url}`)
          }
        })

        // Wait for installation
        s.message("Waiting for GitHub app to be installed")
        const MAX_RETRIES = 60
        let retries = 0
        do {
          const installation = await getInstallation()
          if (installation) break

          if (retries > MAX_RETRIES) {
            s.stop(
              `Failed to detect GitHub app installation. Make sure to install the app for the \`${app.owner}/${app.repo}\` repository.`,
            )
            throw new UI.CancelledError()
          }

          retries++
          await new Promise((resolve) => setTimeout(resolve, 1000))
        } while (true)

        s.stop("Installed GitHub app")

        async function getInstallation() {
          return await fetch(`https://api.opencode.ai/get_github_app_installation?owner=${app.owner}&repo=${app.repo}`)
            .then((res) => res.json())
            .then((data) => data.installation)
        }
      }

      async function addWorkflowFiles() {
        const envStr =
          provider === "amazon-bedrock"
            ? ""
            : `\n        env:${providers[provider].env.map((e) => `\n          ${e}: \${{ secrets.${e} }}`).join("")}`

        await Bun.write(
          path.join(app.root, WORKFLOW_FILE),
          `
name: opencode

on:
  issue_comment:
    types: [created]

jobs:
  opencode:
    if: |
      startsWith(github.event.comment.body, 'opencode') ||
      startsWith(github.event.comment.body, 'hi opencode') ||
      startsWith(github.event.comment.body, 'hey opencode') ||
      contains(github.event.comment.body, '@opencode-agent')
    runs-on: ubuntu-latest
    permissions:
      id-token: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Run opencode
        uses: sst/opencode/sdks/github@github-v1${envStr}
        with:
          model: ${provider}/${model}
`.trim(),
        )

        prompts.log.success(`Added workflow file: "${WORKFLOW_FILE}"`)
      }
    })
  },
})
