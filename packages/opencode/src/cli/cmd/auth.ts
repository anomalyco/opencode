import { Auth } from "../../auth"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { ModelsDev } from "../../provider/models"
import { map, pipe, sortBy, values } from "remeda"
import path from "path"
import os from "os"
import { Global } from "../../global"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import { AuthGithubCopilot } from "../../auth/github-copilot"

export const AuthCommand = cmd({
  command: "auth",
  describe: "manage credentials",
  builder: (yargs) =>
    yargs.command(AuthLoginCommand).command(AuthLogoutCommand).command(AuthListCommand).demandCommand(),
  async handler() {},
})

export const AuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers",
  async handler() {
    UI.empty()
    const authPath = path.join(Global.Path.data, "auth.json")
    const homedir = os.homedir()
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    prompts.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)
    const results = await Auth.all().then((x) => Object.entries(x))
    const database = await ModelsDev.get()

    for (const [providerID, result] of results) {
      const name = database[providerID]?.name || providerID
      prompts.log.info(`${name} ${UI.Style.TEXT_DIM}${result.type}`)
    }

    prompts.outro(`${results.length} credentials`)

    // Environment variables section
    const activeEnvVars: Array<{ provider: string; envVar: string }> = []

    for (const [providerID, provider] of Object.entries(database)) {
      for (const envVar of provider.env) {
        if (process.env[envVar]) {
          activeEnvVars.push({
            provider: provider.name || providerID,
            envVar,
          })
        }
      }
    }

    if (activeEnvVars.length > 0) {
      UI.empty()
      prompts.intro("Environment")

      for (const { provider, envVar } of activeEnvVars) {
        prompts.log.info(`${provider} ${UI.Style.TEXT_DIM}${envVar}`)
      }

      prompts.outro(`${activeEnvVars.length} environment variable` + (activeEnvVars.length === 1 ? "" : "s"))
    }
  },
})

export const AuthLoginCommand = cmd({
  command: "login [url]",
  describe: "log in to a provider",
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "opencode auth provider",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add credential")
      if (args.url) {
        const wellknown = await fetch(`${args.url}/.well-known/opencode`).then((x) => x.json())
        prompts.log.info(`Running \`${wellknown.auth.command.join(" ")}\``)
        const proc = Bun.spawn({
          cmd: wellknown.auth.command,
          stdout: "pipe",
        })
        const exit = await proc.exited
        if (exit !== 0) {
          prompts.log.error("Failed")
          prompts.outro("Done")
          return
        }
        const token = await new Response(proc.stdout).text()
        await Auth.set(args.url, {
          type: "wellknown",
          key: wellknown.auth.env,
          token: token.trim(),
        })
        prompts.log.success("Logged into " + args.url)
        prompts.outro("Done")
        return
      }
      await ModelsDev.refresh().catch(() => {})
      const providers = await ModelsDev.get()
      const priority: Record<string, number> = {
        opencode: 0,
        anthropic: 1,
        "github-copilot": 2,
        openai: 3,
        google: 4,
        openrouter: 5,
        vercel: 6,
      }
      let provider = await prompts.autocomplete({
        message: "Select provider",
        maxItems: 8,
        options: [
          ...pipe(
            providers,
            values(),
            sortBy(
              (x) => priority[x.id] ?? 99,
              (x) => x.name ?? x.id,
            ),
            map((x) => ({
              label: x.name,
              value: x.id,
              hint: priority[x.id] <= 1 ? "recommended" : undefined,
            })),
          ),
          {
            value: "other",
            label: "Other",
          },
        ],
      })

      if (prompts.isCancel(provider)) throw new UI.CancelledError()

      if (provider === "github-copilot") {
        return await handleGithubCopilotAuth(provider)
      }

      const plugin = await Plugin.list().then((x) => x.find((x) => x.auth?.provider === provider))
      if (plugin && plugin.auth) {
        let index = 0
        if (plugin.auth.methods.length > 1) {
          const method = await prompts.select({
            message: "Login method",
            options: [
              ...plugin.auth.methods.map((x, index) => ({
                label: x.label,
                value: index.toString(),
              })),
            ],
          })
          if (prompts.isCancel(method)) throw new UI.CancelledError()
          index = parseInt(method)
        }
        const method = plugin.auth.methods[index]
        if (method.type === "oauth") {
          await new Promise((resolve) => setTimeout(resolve, 10))
          const authorize = await method.authorize()

          if (authorize.url) {
            prompts.log.info("Go to: " + authorize.url)
          }

          if (authorize.method === "auto") {
            if (authorize.instructions) {
              prompts.log.info(authorize.instructions)
            }
            const spinner = prompts.spinner()
            spinner.start("Waiting for authorization...")
            const result = await authorize.callback()
            if (result.type === "failed") {
              spinner.stop("Failed to authorize", 1)
            }
            if (result.type === "success") {
              if ("refresh" in result) {
                await Auth.set(provider, {
                  type: "oauth",
                  refresh: result.refresh,
                  access: result.access,
                  expires: result.expires,
                })
              }
              if ("key" in result) {
                await Auth.set(provider, {
                  type: "api",
                  key: result.key,
                })
              }
              spinner.stop("Login successful")
            }
          }

          if (authorize.method === "code") {
            const code = await prompts.text({
              message: "Paste the authorization code here: ",
              validate: (x) => (x && x.length > 0 ? undefined : "Required"),
            })
            if (prompts.isCancel(code)) throw new UI.CancelledError()
            const result = await authorize.callback(code)
            if (result.type === "failed") {
              prompts.log.error("Failed to authorize")
            }
            if (result.type === "success") {
              if ("refresh" in result) {
                await Auth.set(provider, {
                  type: "oauth",
                  refresh: result.refresh,
                  access: result.access,
                  expires: result.expires,
                })
              }
              if ("key" in result) {
                await Auth.set(provider, {
                  type: "api",
                  key: result.key,
                })
              }
              prompts.log.success("Login successful")
            }
          }
          prompts.outro("Done")
          return
        }
      }

      if (provider === "other") {
        provider = await prompts.text({
          message: "Enter provider id",
          validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
        })
        if (prompts.isCancel(provider)) throw new UI.CancelledError()
        provider = provider.replace(/^@ai-sdk\//, "")
        if (prompts.isCancel(provider)) throw new UI.CancelledError()
        prompts.log.warn(
          `This only stores a credential for ${provider} - you will need configure it in opencode.json, check the docs for examples.`,
        )
      }

      if (provider === "amazon-bedrock") {
        prompts.log.info(
          "Amazon bedrock can be configured with standard AWS environment variables like AWS_BEARER_TOKEN_BEDROCK, AWS_PROFILE or AWS_ACCESS_KEY_ID",
        )
        prompts.outro("Done")
        return
      }

      if (provider === "opencode") {
        prompts.log.info("Create an api key at https://opencode.ai/auth")
      }

      if (provider === "vercel") {
        prompts.log.info("You can create an api key at https://vercel.link/ai-gateway-token")
      }

      const key = await prompts.password({
        message: "Enter your API key",
        validate: (x) => (x && x.length > 0 ? undefined : "Required"),
      })
      if (prompts.isCancel(key)) throw new UI.CancelledError()
      await Auth.set(provider, {
        type: "api",
        key,
      })

      prompts.outro("Done")
      },
    })
  },
})

export const AuthLogoutCommand = cmd({
  command: "logout",
  describe: "log out from a configured provider",
  async handler() {
    UI.empty()
    const credentials = await Auth.all().then((x) => Object.entries(x))
    prompts.intro("Remove credential")
    if (credentials.length === 0) {
      prompts.log.error("No credentials found")
      return
    }
    const database = await ModelsDev.get()
    const providerID = await prompts.select({
      message: "Select provider",
      options: credentials.map(([key, value]) => ({
        label: (database[key]?.name || key) + UI.Style.TEXT_DIM + " (" + value.type + ")",
        value: key,
      })),
    })
    if (prompts.isCancel(providerID)) throw new UI.CancelledError()
    await Auth.remove(providerID)
    prompts.outro("Logout successful")
  },
})

async function handleGithubCopilotAuth(providerID: string) {
  try {
    const deploymentType = await prompts.select({
      message: "Select GitHub deployment type",
      options: [
        {
          label: "GitHub.com",
          value: "github.com",
          hint: "Public",
        },
        {
          label: "GitHub Enterprise",
          value: "enterprise",
          hint: "Data residency or self-hosted",
        },
      ],
    })

    if (prompts.isCancel(deploymentType)) throw new UI.CancelledError()

    let enterpriseUrl: string | undefined
    let actualProviderID = providerID

    if (deploymentType === "enterprise") {
      const enterpriseHost = await prompts.text({
        message: "Enter your GitHub Enterprise URL or domain",
        placeholder: "company.ghe.com or https://company.ghe.com",
        validate: (value) => {
          if (!value) return "URL or domain is required"
          try {
            // Test if it's a valid URL
            const url = value.includes("://") ? new URL(value) : new URL(`https://${value}`)
            if (!url.hostname) return "Please enter a valid URL or domain"
            return undefined
          } catch {
            return "Please enter a valid URL (e.g., company.ghe.com or https://company.ghe.com)"
          }
        },
      })

      if (prompts.isCancel(enterpriseHost)) throw new UI.CancelledError()

      enterpriseUrl = enterpriseHost.includes("://") ? enterpriseHost : `https://${enterpriseHost}`

      actualProviderID = "github-copilot-enterprise"
    }

    const authorize = await AuthGithubCopilot.authorize(actualProviderID, enterpriseUrl)

    prompts.log.info(`Go to: ${authorize.verification}`)
    prompts.log.info(`Enter code: ${authorize.user}`)

    const spinner = prompts.spinner()
    spinner.start("Waiting for authorization...")

    let attempts = 0
    const maxAttempts = Math.ceil(authorize.expiry / authorize.interval)

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, authorize.interval * 1000))

      const result = await AuthGithubCopilot.poll(authorize.device, actualProviderID, enterpriseUrl)

      if (result === "complete") {
        spinner.stop("Login successful")
        prompts.outro("Done")
        return
      } else if (result === "failed") {
        spinner.stop("Failed to authorize", 1)
        prompts.outro("Authentication failed")
        return
      }

      attempts++
    }

    spinner.stop("Authorization timed out", 1)
    prompts.outro("Please try again")
  } catch (error) {
    prompts.log.error(`Authentication failed: ${error instanceof Error ? error.message : String(error)}`)
    prompts.outro("Done")
  }
}
