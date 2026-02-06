import type { Argv, CommandModule } from "yargs"
import * as prompts from "@clack/prompts"
import path from "path"
import fs from "fs"
import os from "os"
import { execSync } from "child_process"
import { UI } from "../../opencode/src/cli/ui"
import { BrokerClient } from "@opencode-ai/fork-auth/auth/broker-client"

type EmptyArgs = Record<string, never>

const BrokerSetupCommand: CommandModule<EmptyArgs, EmptyArgs> = {
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
      } catch {
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
      } catch {
        prompts.log.warn("Failed to start systemd service. You may need to start it manually.")
      }
    }

    prompts.outro("Auth broker setup complete! Check status with: opencode auth broker status")
  },
}

const BrokerStatusCommand: CommandModule<EmptyArgs, EmptyArgs> = {
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
}

const BrokerCommand: CommandModule<EmptyArgs, EmptyArgs> = {
  command: "broker <subcommand>",
  describe: "manage system authentication broker",
  builder: (yargs) =>
    yargs.command(BrokerSetupCommand).command(BrokerStatusCommand).demandCommand(1, "Specify: setup or status"),
  async handler() {},
}

export function registerAuthBrokerCommands<T>(yargs: Argv<T>): Argv<T> {
  return yargs.command(BrokerCommand as any)
}

/**
 * Find the opencode-broker binary in common locations.
 */
function findBrokerBinary(): string | null {
  const candidates = [
    path.join(process.cwd(), "packages/opencode-broker/target/release/opencode-broker"),
    // Monorepo root from packages/opencode
    path.join(process.cwd(), "../opencode-broker/target/release/opencode-broker"),
    // Development: relative to script location (src/cli/cmd -> ../../opencode-broker)
    path.join(path.dirname(process.argv[1] ?? ""), "../../opencode-broker/target/release/opencode-broker"),
    // Common install location
    "/usr/local/bin/opencode-broker",
    // Fallbacks for Linux
    path.join(os.homedir(), ".local/bin/opencode-broker"),
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
    path.join(process.cwd(), "packages/opencode-broker"),
    // Monorepo root from packages/opencode
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
