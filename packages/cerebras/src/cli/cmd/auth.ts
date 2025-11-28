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
import { ClerkAuthProvider } from "../../auth/clerk"
import { ClerkConfigManager } from "../../config/clerk"
import { CredentialStorage } from "../../storage/credentials"

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
  describe: "log in to Cerebras or a provider",
  builder: (yargs) =>
    yargs
      .positional("url", {
        describe: "cerebras auth provider",
        type: "string",
      })
      .option("provider", {
        describe: "login to a specific AI provider instead of Cerebras",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    // Check if this is a Clerk-based Cerebras login (default)
    // Skip Clerk if CEREBRAS_SKIP_AUTH is set
    const skipClerkAuth = process.env.CEREBRAS_SKIP_AUTH === 'true'

    if (!args.provider && !args.url && ClerkConfigManager.isConfigured() && !skipClerkAuth) {
      UI.empty()

      // Check if already logged in
      const isAuthenticated = await CredentialStorage.isAuthenticated()
      if (isAuthenticated) {
        const session = await CredentialStorage.getSession()
        if (session) {
          const config = ClerkConfigManager.getConfig()
          const auth = new ClerkAuthProvider(config)
          const user = await auth.getUser(session.userId)

          prompts.intro("Already logged in")
          if (user) {
            prompts.log.info(`User: ${user.emailAddresses[0]?.emailAddress || user.id}`)
          }

          const shouldLogout = await prompts.confirm({
            message: "Would you like to logout and login again?",
            initialValue: false,
          })

          if (prompts.isCancel(shouldLogout) || !shouldLogout) {
            prompts.outro("Done")
            return
          }

          await CredentialStorage.clear()
        }
      }

      // Start Clerk login flow
      const config = ClerkConfigManager.getConfig()
      const auth = new ClerkAuthProvider(config)

      try {
        const session = await auth.interactiveLogin()

        if (session) {
          await CredentialStorage.updateSession(session)

          const user = await auth.getUser(session.userId)
          prompts.log.success("Login successful!")
          if (user) {
            prompts.log.info(`Welcome, ${user.emailAddresses[0]?.emailAddress || user.id}`)
          }
          prompts.outro("Done")
        } else {
          prompts.outro("Login failed")
        }
      } catch (error) {
        if (error instanceof UI.CancelledError) {
          prompts.outro("Login cancelled")
        } else {
          prompts.log.error("Login failed: " + (error instanceof Error ? error.message : String(error)))
          prompts.outro("Failed")
        }
      }

      return
    }

    // Fall back to provider-based authentication (existing code)
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add provider credential")
        if (args.url) {
          const wellknown = await fetch(`${args.url}/.well-known/opencode`).then((x) => x.json() as any)
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

          // Handle prompts for all auth types
          await new Promise((resolve) => setTimeout(resolve, 10))
          const inputs: Record<string, string> = {}
          if (method.prompts) {
            for (const prompt of method.prompts) {
              if (prompt.condition && !prompt.condition(inputs)) {
                continue
              }
              if (prompt.type === "select") {
                const value = await prompts.select({
                  message: prompt.message,
                  options: prompt.options,
                })
                if (prompts.isCancel(value)) throw new UI.CancelledError()
                inputs[prompt.key] = value
              } else {
                const value = await prompts.text({
                  message: prompt.message,
                  placeholder: prompt.placeholder,
                  validate: prompt.validate ? (v) => prompt.validate!(v ?? "") : undefined,
                })
                if (prompts.isCancel(value)) throw new UI.CancelledError()
                inputs[prompt.key] = value
              }
            }
          }

          if (method.type === "oauth") {
            const authorize = await method.authorize(inputs)

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
                const saveProvider = result.provider ?? provider
                if ("refresh" in result) {
                  const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
                  await Auth.set(saveProvider, {
                    type: "oauth",
                    refresh,
                    access,
                    expires,
                    ...extraFields,
                  })
                }
                if ("key" in result) {
                  await Auth.set(saveProvider, {
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
                const saveProvider = result.provider ?? provider
                if ("refresh" in result) {
                  const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
                  await Auth.set(saveProvider, {
                    type: "oauth",
                    refresh,
                    access,
                    expires,
                    ...extraFields,
                  })
                }
                if ("key" in result) {
                  await Auth.set(saveProvider, {
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

          if (method.type === "api") {
            if (method.authorize) {
              const result = await method.authorize(inputs)
              if (result.type === "failed") {
                prompts.log.error("Failed to authorize")
              }
              if (result.type === "success") {
                const saveProvider = result.provider ?? provider
                await Auth.set(saveProvider, {
                  type: "api",
                  key: result.key,
                })
                prompts.log.success("Login successful")
              }
              prompts.outro("Done")
              return
            }
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
          prompts.log.info("Create an api key at https://cerebras.dev/auth")
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
