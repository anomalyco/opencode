import { AuthAnthropic } from "../../auth/anthropic"
import { AuthGithubCopilot } from "../../auth/github-copilot"
import { Auth } from "../../auth"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import open from "open"
import { UI } from "../ui"
import { ModelsDev } from "../../provider/models"
import { map, pipe, sortBy, values } from "remeda"

export const AuthCommand = cmd({
  command: "auth",
  describe: "Manage credentials",
  builder: (yargs) =>
    yargs
      .command(AuthLoginCommand)
      .command(AuthLogoutCommand)
      .command(AuthListCommand)
      .demandCommand(),
  async handler() {},
})

export const AuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers",
  async handler() {
    UI.empty()
    prompts.intro("Credentials")
    const results = await Auth.all().then((x) => Object.entries(x))
    const database = await ModelsDev.get()

    for (const [providerID, result] of results) {
      const name = database[providerID]?.name || providerID
      prompts.log.info(`${name} ${UI.Style.TEXT_DIM}(${result.type})`)
    }

    prompts.outro(`${results.length} credentials`)
  },
})

export const AuthLoginCommand = cmd({
  command: "login",
  describe: "login to a provider",
  async handler() {
    UI.empty()
    prompts.intro("Add credential")
    const providers = await ModelsDev.get()
    const priority: Record<string, number> = {
      anthropic: 0,
      "github-copilot": 1,
      openai: 2,
      google: 3,
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
          value: "github-copilot",
          label: "GitHub Copilot",
        },
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
        validate: (x) =>
          x.match(/^[a-z-]+$/) ? undefined : "a-z and hyphens only",
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
        "Amazon bedrock can be configured with standard AWS environment variables like AWS_PROFILE or AWS_ACCESS_KEY_ID",
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
            value: "oauth",
          },
          {
            label: "API Key",
            value: "api",
          },
        ],
      })
      if (prompts.isCancel(method)) throw new UI.CancelledError()

      if (method === "oauth") {
        // some weird bug where program exits without this
        await new Promise((resolve) => setTimeout(resolve, 10))
        const { url, verifier } = await AuthAnthropic.authorize()
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

        await AuthAnthropic.exchange(code, verifier)
          .then(() => {
            prompts.log.success("Login successful")
          })
          .catch(() => {
            prompts.log.error("Invalid code")
          })
        prompts.outro("Done")
        return
      }
    }

    if (provider === "github-copilot") {
      await new Promise((resolve) => setTimeout(resolve, 10))
      const deviceInfo = await AuthGithubCopilot.authorize()

      prompts.note(
        `Please visit: ${deviceInfo.verification}\nEnter code: ${deviceInfo.user}`,
      )

      const spinner = prompts.spinner()
      spinner.start("Waiting for authorization...")

      while (true) {
        await new Promise((resolve) =>
          setTimeout(resolve, deviceInfo.interval * 1000),
        )
        const status = await AuthGithubCopilot.poll(deviceInfo.device)
        if (status === "pending") continue
        if (status === "complete") {
          spinner.stop("Login successful")
          break
        }
        if (status === "failed") {
          spinner.stop("Failed to authorize", 1)
          break
        }
      }

      prompts.outro("Done")
      return
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
  describe: "logout from a configured provider",
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
        label:
          (database[key]?.name || key) +
          UI.Style.TEXT_DIM +
          " (" +
          value.type +
          ")",
        value: key,
      })),
    })
    if (prompts.isCancel(providerID)) throw new UI.CancelledError()
    await Auth.remove(providerID)
    prompts.outro("Logout successful")
  },
})
