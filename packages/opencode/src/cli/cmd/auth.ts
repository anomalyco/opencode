import { Auth, BrokerClient } from "../../auth"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { ModelsDev } from "../../provider/models"
import { map, pipe, sortBy, values } from "remeda"
import path from "path"
import os from "os"
import fs from "fs"
import { execSync } from "child_process"
import { Config } from "../../config/config"
import { Global } from "../../global"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import type { Hooks } from "@opencode-ai/plugin"

type PluginAuth = NonNullable<Hooks["auth"]>

/**
 * Handle plugin-based authentication flow.
 * Returns true if auth was handled, false if it should fall through to default handling.
 */
async function handlePluginAuth(plugin: { auth: PluginAuth }, provider: string): Promise<boolean> {
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
  await Bun.sleep(10)
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
    return true
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
      return true
    }
  }

  return false
}

export const AuthCommand = cmd({
  command: "auth",
  describe: "manage credentials",
  builder: (yargs) =>
    yargs
      .command(AuthLoginCommand)
      .command(AuthLogoutCommand)
      .command(AuthListCommand)
      .command(BrokerCommand)
      .demandCommand(),
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
    const results = Object.entries(await Auth.all())
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

        const config = await Config.get()

        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

        const providers = await ModelsDev.get().then((x) => {
          const filtered: Record<string, (typeof x)[string]> = {}
          for (const [key, value] of Object.entries(x)) {
            if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
              filtered[key] = value
            }
          }
          return filtered
        })

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
                hint: {
                  opencode: "recommended",
                  anthropic: "Claude Max or API key",
                  openai: "ChatGPT Plus/Pro or API key",
                }[x.id],
              })),
            ),
            {
              value: "other",
              label: "Other",
            },
          ],
        })

        if (prompts.isCancel(provider)) throw new UI.CancelledError()

        const plugin = await Plugin.list().then((x) => x.findLast((x) => x.auth?.provider === provider))
        if (plugin && plugin.auth) {
          const handled = await handlePluginAuth({ auth: plugin.auth }, provider)
          if (handled) return
        }

        if (provider === "other") {
          provider = await prompts.text({
            message: "Enter provider id",
            validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
          })
          if (prompts.isCancel(provider)) throw new UI.CancelledError()
          provider = provider.replace(/^@ai-sdk\//, "")
          if (prompts.isCancel(provider)) throw new UI.CancelledError()

          // Check if a plugin provides auth for this custom provider
          const customPlugin = await Plugin.list().then((x) => x.findLast((x) => x.auth?.provider === provider))
          if (customPlugin && customPlugin.auth) {
            const handled = await handlePluginAuth({ auth: customPlugin.auth }, provider)
            if (handled) return
          }

          prompts.log.warn(
            `This only stores a credential for ${provider} - you will need configure it in opencode.json, check the docs for examples.`,
          )
        }

        if (provider === "amazon-bedrock") {
          prompts.log.info(
            "Amazon Bedrock authentication priority:\n" +
              "  1. Bearer token (AWS_BEARER_TOKEN_BEDROCK or /connect)\n" +
              "  2. AWS credential chain (profile, access keys, IAM roles, EKS IRSA)\n\n" +
              "Configure via opencode.json options (profile, region, endpoint) or\n" +
              "AWS environment variables (AWS_PROFILE, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_WEB_IDENTITY_TOKEN_FILE).",
          )
        }

        if (provider === "opencode") {
          prompts.log.info("Create an api key at https://opencode.ai/auth")
        }

        if (provider === "vercel") {
          prompts.log.info("You can create an api key at https://vercel.link/ai-gateway-token")
        }

        if (["cloudflare", "cloudflare-ai-gateway"].includes(provider)) {
          prompts.log.info(
            "Cloudflare AI Gateway can be configured with CLOUDFLARE_GATEWAY_ID, CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_API_TOKEN environment variables. Read more: https://opencode.ai/docs/providers/#cloudflare-ai-gateway",
          )
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

// Broker commands - system authentication broker management

export const BrokerCommand = cmd({
  command: "broker <subcommand>",
  describe: "manage system authentication broker",
  builder: (yargs) =>
    yargs.command(BrokerSetupCommand).command(BrokerStatusCommand).demandCommand(1, "Specify: setup or status"),
  async handler() {},
})

export const BrokerSetupCommand = cmd({
  command: "setup",
  describe: "install and configure the auth broker (requires sudo)",
  async handler() {
    UI.empty()
    prompts.intro("Auth Broker Setup")

    // Check if running as root/sudo
    if (process.getuid?.() !== 0) {
      prompts.log.error("This command requires root privileges.")
      prompts.log.info("Run with: sudo opencode auth broker setup")
      process.exit(1)
    }

    // Find broker binary
    const brokerBinaryPath = findBrokerBinary()
    if (!brokerBinaryPath) {
      prompts.log.error("Auth broker binary not found.")
      prompts.log.info("Build with: cd packages/opencode-broker && cargo build --release")
      process.exit(1)
    }

    // Install binary to /usr/local/bin
    const targetBinaryPath = "/usr/local/bin/opencode-broker"
    prompts.log.step(`Installing broker to ${targetBinaryPath}...`)
    fs.copyFileSync(brokerBinaryPath, targetBinaryPath)
    fs.chmodSync(targetBinaryPath, 0o755)

    // Create socket directory
    const socketDir = process.platform === "darwin" ? "/var/run/opencode" : "/run/opencode"
    if (!fs.existsSync(socketDir)) {
      fs.mkdirSync(socketDir, { mode: 0o755 })
      prompts.log.step(`Created socket directory: ${socketDir}`)
    }

    // Find package directory for service files
    const packageDir = findBrokerPackageDir()
    if (!packageDir) {
      prompts.log.error("Could not find opencode-broker package directory")
      process.exit(1)
    }

    // Install PAM service file
    const pamSource =
      process.platform === "darwin"
        ? path.join(packageDir, "service/opencode.pam.macos")
        : path.join(packageDir, "service/opencode.pam")
    const pamDest = "/etc/pam.d/opencode"
    prompts.log.step(`Installing PAM config to ${pamDest}...`)
    fs.copyFileSync(pamSource, pamDest)
    fs.chmodSync(pamDest, 0o644)

    // Install and enable service (platform-specific)
    if (process.platform === "darwin") {
      const plistSource = path.join(packageDir, "service/com.opencode.broker.plist")
      const plistDest = "/Library/LaunchDaemons/com.opencode.broker.plist"
      prompts.log.step("Installing launchd service...")
      fs.copyFileSync(plistSource, plistDest)
      fs.chmodSync(plistDest, 0o644)

      try {
        // Unload if already loaded (ignore errors)
        try {
          execSync("launchctl unload /Library/LaunchDaemons/com.opencode.broker.plist 2>/dev/null", {
            stdio: "ignore",
          })
        } catch {
          // Ignore - may not be loaded
        }
        execSync("launchctl load /Library/LaunchDaemons/com.opencode.broker.plist")
        prompts.log.success("Launchd service loaded")
      } catch (err) {
        prompts.log.warn("Failed to load launchd service. You may need to load it manually.")
      }
    } else {
      const serviceSource = path.join(packageDir, "service/opencode-broker.service")
      const serviceDest = "/etc/systemd/system/opencode-broker.service"
      prompts.log.step("Installing systemd service...")
      fs.copyFileSync(serviceSource, serviceDest)
      fs.chmodSync(serviceDest, 0o644)

      try {
        execSync("systemctl daemon-reload")
        execSync("systemctl enable opencode-broker")
        execSync("systemctl start opencode-broker")
        prompts.log.success("Systemd service enabled and started")
      } catch (err) {
        prompts.log.warn("Failed to start systemd service. You may need to start it manually.")
      }
    }

    prompts.outro("Auth broker setup complete! Check status with: opencode auth broker status")
  },
})

export const BrokerStatusCommand = cmd({
  command: "status",
  describe: "check auth broker status",
  async handler() {
    UI.empty()
    prompts.intro("Auth Broker Status")

    // Check if service is running (platform-specific)
    let serviceStatus = "unknown"
    try {
      if (process.platform === "darwin") {
        const output = execSync("launchctl list com.opencode.broker 2>&1", { encoding: "utf8" })
        // launchctl list shows the service info if loaded
        serviceStatus = output.includes("PID") || output.includes('"PID"') ? "running" : "stopped"
      } else {
        const output = execSync("systemctl is-active opencode-broker 2>&1", { encoding: "utf8" })
        serviceStatus = output.trim()
      }
    } catch {
      serviceStatus = "not installed"
    }

    prompts.log.info(`Service: ${serviceStatus}`)

    // Ping broker
    const client = new BrokerClient()
    const brokerResponding = await client.ping()
    prompts.log.info(`Broker responding: ${brokerResponding ? "yes" : "no"}`)

    // Check PAM config
    const pamExists = fs.existsSync("/etc/pam.d/opencode")
    prompts.log.info(`PAM config: ${pamExists ? "installed" : "missing"}`)

    // Check broker binary
    const binaryExists = fs.existsSync("/usr/local/bin/opencode-broker")
    prompts.log.info(`Broker binary: ${binaryExists ? "installed" : "missing"}`)

    if (!brokerResponding && serviceStatus === "running") {
      prompts.log.warn("Service is running but broker is not responding.")
      if (process.platform === "darwin") {
        prompts.log.info("Check logs with: cat /var/log/opencode-broker.log")
      } else {
        prompts.log.info("Check logs with: journalctl -u opencode-broker")
      }
    }

    prompts.outro("")
  },
})

/**
 * Find the opencode-broker binary in common locations.
 */
function findBrokerBinary(): string | null {
  const candidates = [
    // Development: relative to cwd (monorepo root)
    path.join(process.cwd(), "packages/opencode-broker/target/release/opencode-broker"),
    // Development: relative to packages/opencode (when run via bun run dev)
    path.join(process.cwd(), "../opencode-broker/target/release/opencode-broker"),
    // Development: relative to script location (src/cli/cmd -> ../../opencode-broker)
    path.join(path.dirname(process.argv[1] ?? ""), "../../opencode-broker/target/release/opencode-broker"),
    // Installed location
    "/usr/local/bin/opencode-broker",
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

/**
 * Find the opencode-broker package directory for service files.
 */
function findBrokerPackageDir(): string | null {
  const candidates = [
    // Development: relative to cwd (monorepo root)
    path.join(process.cwd(), "packages/opencode-broker"),
    // Development: relative to packages/opencode (when run via bun run dev)
    path.join(process.cwd(), "../opencode-broker"),
    // Development: relative to script location (src/cli/cmd -> ../../opencode-broker)
    path.join(path.dirname(process.argv[1] ?? ""), "../../opencode-broker"),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "Cargo.toml"))) {
      return candidate
    }
  }
  return null
}
