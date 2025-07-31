import { AuthAnthropic } from "../../auth/anthropic"
import { AuthCopilot } from "../../auth/copilot"
import { Auth } from "../../auth"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import open from "open"
import { UI } from "../ui"
import { ModelsDev } from "../../provider/models"
import { map, pipe, sortBy, values } from "remeda"
import path from "path"
import os from "os"
import { Global } from "../../global"

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
    UI.empty()
    const providers = await ModelsDev.get()
    const priority: Record<string, number> = {
      anthropic: 0,
      "github-copilot": 1,
      openai: 2,
      google: 3,
      openrouter: 4,
      vercel: 5,
    }
    let provider = await prompts.select({
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
            hint: priority[x.id] === 0 ? "recommended" : undefined,
          })),
        ),
        {
          value: "other",
          label: "Other",
        },
      ],
    })

    if (prompts.isCancel(provider)) throw new UI.CancelledError()

    if (provider === "other") {
      provider = await prompts.text({
        message: "Enter provider id",
        validate: (x) => (x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
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

    if (provider === "anthropic") {
      const method = await prompts.select({
        message: "Login method",
        options: [
          {
            label: "Claude Pro/Max",
            value: "max",
          },
          {
            label: "Create API Key",
            value: "console",
          },
          {
            label: "Manually enter API Key",
            value: "api",
          },
        ],
      })
      if (prompts.isCancel(method)) throw new UI.CancelledError()

      if (method === "max") {
        // some weird bug where program exits without this
        await new Promise((resolve) => setTimeout(resolve, 10))
        const { url, verifier } = await AuthAnthropic.authorize("max")
        prompts.note("Trying to open browser...")
        try {
          await open(url)
        } catch (e) {
          prompts.log.error(
            "Failed to open browser perhaps you are running without a display or X server, please open the following URL in your browser:",
          )
        }
        prompts.log.info(url)

        const code = await prompts.text({
          message: "Paste the authorization code here: ",
          validate: (x) => (x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(code)) throw new UI.CancelledError()

        try {
          const credentials = await AuthAnthropic.exchange(code, verifier)
          await Auth.set("anthropic", {
            type: "oauth",
            refresh: credentials.refresh,
            access: credentials.access,
            expires: credentials.expires,
          })
          prompts.log.success("Login successful")
        } catch {
          prompts.log.error("Invalid code")
        }
        prompts.outro("Done")
        return
      }

      if (method === "console") {
        // some weird bug where program exits without this
        await new Promise((resolve) => setTimeout(resolve, 10))
        const { url, verifier } = await AuthAnthropic.authorize("console")
        prompts.note("Trying to open browser...")
        try {
          await open(url)
        } catch (e) {
          prompts.log.error(
            "Failed to open browser perhaps you are running without a display or X server, please open the following URL in your browser:",
          )
        }
        prompts.log.info(url)

        const code = await prompts.text({
          message: "Paste the authorization code here: ",
          validate: (x) => (x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(code)) throw new UI.CancelledError()

        try {
          const credentials = await AuthAnthropic.exchange(code, verifier)
          const accessToken = credentials.access
          const response = await fetch("https://api.anthropic.com/api/oauth/claude_cli/create_api_key", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json, text/plain, */*",
            },
          })
          if (!response.ok) {
            throw new Error("Failed to create API key")
          }
          const json = await response.json()
          await Auth.set("anthropic", {
            type: "api",
            key: json.raw_key,
          })

          prompts.log.success("Login successful - API key created and saved")
        } catch (error) {
          prompts.log.error("Invalid code or failed to create API key")
        }
        prompts.outro("Done")
        return
      }
    }

    const copilot = await AuthCopilot()
    if (provider === "github-copilot" && copilot) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      const deviceInfo = await copilot.authorize()

      prompts.note(`Please visit: ${deviceInfo.verification}\nEnter code: ${deviceInfo.user}`)

      const spinner = prompts.spinner()
      spinner.start("Waiting for authorization...")

      while (true) {
        await new Promise((resolve) => setTimeout(resolve, deviceInfo.interval * 1000))
        const response = await copilot.poll(deviceInfo.device)
        if (response.status === "pending") continue
        if (response.status === "success") {
          await Auth.set("github-copilot", {
            type: "oauth",
            refresh: response.refresh,
            access: response.access,
            expires: response.expires,
          })
          spinner.stop("Login successful")
          break
        }
        if (response.status === "failed") {
          spinner.stop("Failed to authorize", 1)
          break
        }
      }

      prompts.outro("Done")
      return
    }

    if (provider === "vercel") {
      prompts.log.info("You can create an api key in the dashboard")
    }

    const key = await prompts.password({
      message: "Enter your API key",
      validate: (x) => (x.length > 0 ? undefined : "Required"),
    })
    if (prompts.isCancel(key)) throw new UI.CancelledError()
    await Auth.set(provider, {
      type: "api",
      key,
    })

    prompts.outro("Done")
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
