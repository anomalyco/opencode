import path from "path"
import fs from "fs/promises"
import { cmd } from "./cmd"
import { Flag } from "../../flag/flag"

interface IMTemplate {
  name: string
  type: string
  description: string
  botUrl: string
  userIdUrl?: string
  configKeys: string[]
  exampleConfig: any
}

const IM_TEMPLATES: Record<string, IMTemplate> = {
  telegram: {
    name: "Telegram",
    type: "telegram",
    description: "Telegram Bot API integration",
    botUrl: "https://t.me/BotFather",
    userIdUrl: "https://t.me/userinfobot",
    configKeys: ["token"],
    exampleConfig: {
      token: "YOUR_TELEGRAM_BOT_TOKEN",
      maxFileSize: 20971520,
      allowedTypes: ["image/*", "application/pdf", "text/*"],
      storagePath: "~/.opencode/im-media",
      cleanupDays: 15,
      allowedUsers: []
    }
  },
  slack: {
    name: "Slack",
    type: "slack",
    description: "Slack Bot API integration",
    botUrl: "https://api.slack.com/apps",
    userIdUrl: undefined,
    configKeys: ["botToken", "signingSecret", "appToken"],
    exampleConfig: {
      botToken: "xoxb-YOUR-BOT-TOKEN",
      signingSecret: "YOUR_SIGNING_SECRET",
      appToken: "xapp-YOUR-APP-TOKEN",
      maxFileSize: 20971520,
      allowedTypes: ["image/*", "application/pdf", "text/*"],
      storagePath: "~/.opencode/im-media",
      cleanupDays: 15,
      allowedUsers: []
    }
  },
  whatsapp: {
    name: "WhatsApp",
    type: "whatsapp",
    description: "WhatsApp Business API integration (coming soon)",
    botUrl: "https://developers.facebook.com/docs/whatsapp",
    userIdUrl: undefined,
    configKeys: ["token", "phoneNumberId"],
    exampleConfig: {
      token: "YOUR_WHATSAPP_TOKEN",
      phoneNumberId: "YOUR_PHONE_NUMBER_ID",
      maxFileSize: 20971520,
      allowedTypes: ["image/*", "application/pdf", "text/*"],
      storagePath: "~/.opencode/im-media",
      cleanupDays: 15
    }
  },
  discord: {
    name: "Discord",
    type: "discord",
    description: "Discord Bot API integration (coming soon)",
    botUrl: "https://discord.com/developers/applications",
    userIdUrl: undefined,
    configKeys: ["token", "clientId"],
    exampleConfig: {
      token: "YOUR_DISCORD_BOT_TOKEN",
      clientId: "YOUR_CLIENT_ID",
      maxFileSize: 20971520,
      allowedTypes: ["image/*", "application/pdf", "text/*"],
      storagePath: "~/.opencode/im-media",
      cleanupDays: 15
    }
  }
}

export const InitCommand = cmd({
  command: "init",
  describe: "Initialize IM integration configuration",
  builder: (yargs) => {
    return yargs
      .option("platform", {
        alias: "p",
        describe: "IM platform to configure (telegram, slack, whatsapp, discord)",
        type: "string",
        choices: Object.keys(IM_TEMPLATES)
      })
      .option("token", {
        alias: "t",
        describe: "Bot token for IM platform",
        type: "string"
      })
  },
  handler: async (args: any) => {
    const rootDir = process.cwd()
    const configDir = path.join(rootDir, ".opencode")
    const configFile = path.join(configDir, "opencode.json")

    console.log("🚀 OpenCode IM Integration Setup")
    console.log("")
    console.log("📁 Project root:", rootDir)
    console.log("📁 Config directory:", configDir)
    console.log("📄 Config file:", configFile)
    console.log("")

    const imType = args.platform || await selectIMPlatform()

    if (!IM_TEMPLATES[imType]) {
      console.log(`❌ Unknown IM platform: ${imType}`)
      console.log("Available platforms:", Object.keys(IM_TEMPLATES).join(", "))
      return
    }

    const template = IM_TEMPLATES[imType]
    const config = await loadConfig(configFile)

    if (!config.im || config.im.type !== imType) {
      console.log(`📝 Creating ${template.name} configuration...`)
      console.log("")

      const imConfig = { ...template.exampleConfig }
      
      if (args.token) {
        imConfig.token = args.token
      } else {
        console.log(`${template.name} Bot Token:`, " ".repeat(20).slice(0, 20) + ")")
        const token = await readlineSync("  > ")
        if (token.trim()) {
          imConfig.token = token.trim()
        }
      }

      if (imType === "telegram" && (!imConfig.allowedUsers || imConfig.allowedUsers.length === 0)) {
        console.log("Telegram User ID (optional, for authentication):", " ".repeat(20).slice(0, 20) + ")")
        const userId = await readlineSync("  > ")
        if (userId.trim()) {
          imConfig.allowedUsers = [parseInt(userId.trim())]
        }
      }

      config.im = imConfig as any
      config.projects = config.projects || {}

      await fs.writeFile(configFile, JSON.stringify(config, null, 2))
      console.log("")
      console.log(`✅ ${template.name} configuration saved to: ${configFile}`)
      console.log("")
      console.log("📝 Configuration location (same as OpenCode):")
      console.log(`   ${configFile}`)
      console.log("")
      console.log("🚀 Next steps:")
      console.log("   1. Edit the config file with your bot token:")
      console.log(`   ${configFile}`)
      console.log("   2. Start OpenCode:")
      console.log("   opencode serve")
      console.log("")
      console.log("💡 You can also use command line:")
      console.log("   opencode init --platform telegram --token YOUR_TOKEN")
    } else {
      console.log(`✅ ${template.name} already configured`)
      console.log("")
      console.log("📄 Config file:", configFile)
    }
  },
})
      .option("token", {
        alias: "t",
        describe: "Bot token for IM platform",
        type: "string"
      })
  },
  handler: async (args: any) => {
    const rootDir = process.cwd()
    const configFile = path.join(rootDir, ".opencode.json")

    console.log("🚀 OpenCode IM Integration Setup")
    console.log("")
    console.log("📁 Project root:", rootDir)
    console.log("📄 Config file:", configFile)
    console.log("")

    const imType = args.platform || await selectIMPlatform()

    if (!IM_TEMPLATES[imType]) {
      console.log(`❌ Unknown IM platform: ${imType}`)
      console.log("Available platforms:", Object.keys(IM_TEMPLATES).join(", "))
      return
    }

    const template = IM_TEMPLATES[imType]
    const config = await loadConfig(configFile)

    if (!config.im || config.im.type !== imType) {
      console.log(`📝 Setting up ${template.name} integration...`)
      console.log("")

      const imConfig = { ...template.exampleConfig }
      
      if (args.token) {
        imConfig.token = args.token
      } else {
        console.log(`${template.name} Bot Token:`, " ".repeat(20).slice(0, 20) + ")")
        const token = await readlineSync("  > ")
        if (token.trim()) {
          imConfig.token = token.trim()
        }
      }

      if (imType === "telegram" && (!imConfig.allowedUsers || imConfig.allowedUsers.length === 0)) {
        console.log("Telegram User ID (optional, for authentication):", " ".repeat(20).slice(0, 20) + ")")
        const userId = await readlineSync("  > ")
        if (userId.trim()) {
          imConfig.allowedUsers = [parseInt(userId.trim())]
        }
      }

      config.im = imConfig as any
      config.projects = config.projects || {}

      await fs.writeFile(configFile, JSON.stringify(config, null, 2))
      console.log("")
      console.log(`✅ ${template.name} configuration saved to: ${configFile}`)
      console.log("")
      console.log("📝 NOTE: This configuration is in the project directory")
      console.log("   It will be tracked by git if you commit it")
      console.log("   DO NOT commit with sensitive data (tokens, user IDs)")
    } else {
      console.log(`✅ ${template.name} already configured`)
    }

    console.log("")
    console.log("📝 Setup Summary:")
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━")
    console.log(`  Platform: ${template.name}`)
    console.log(`  Type: ${template.type}`)
    
    if (template.configKeys.length > 0) {
      console.log(`  Config keys: ${template.configKeys.join(", ")}`)
      console.log("")
      console.log("🔗 Setup Resources:")
      console.log(`  Bot Setup: ${template.botUrl}`)
      if (template.userIdUrl) {
        console.log(`  Get User ID: ${template.userIdUrl}`)
      }
    }
    
    console.log("")
    console.log("📁 Config file:", configFile)
    console.log("")
    console.log("🚀 Start server:")
    console.log("   opencode serve")
    console.log("")
    console.log("💡 To configure a different platform:")
    console.log(`   opencode init --platform <${Object.keys(IM_TEMPLATES).join("|")}>`)
  },
})

async function selectIMPlatform(): Promise<string> {
  console.log("Select IM platform to configure:")
  console.log("")

  const platforms = Object.entries(IM_TEMPLATES)
  platforms.forEach(([key, template], index) => {
    console.log(`  ${index + 1}. ${template.name.padEnd(12)} ${template.description}`)
  })

  console.log("")
  const choice = await readlineSync("Enter platform number (1-" + platforms.length + "): ")
  const selectedIndex = parseInt(choice) - 1

  if (selectedIndex < 0 || selectedIndex >= platforms.length) {
    throw new Error("Invalid choice")
  }

  return platforms[selectedIndex][0]
}

async function readlineSync(prompt: string): Promise<string> {
  const readline = (await import("readline")).createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise((resolve) => {
    readline.question(prompt, (answer: string) => {
      readline.close()
      resolve(answer)
    })
  })
}

async function loadConfig(configFile: string): Promise<any> {
  try {
    const content = await fs.readFile(configFile, "utf-8").catch(() => null)
    return content ? JSON.parse(content) : {}
  } catch {
    return {}
  }
}

    const template = IM_TEMPLATES[imType]
    const config = await loadConfig(configFile)

    if (!config.im || config.im.type !== imType) {
      console.log(`📝 Setting up ${template.name} integration...`)
      console.log("")

      const imConfig = { ...template.exampleConfig }
      
      if (args.token) {
        imConfig.token = args.token
      } else {
        console.log(`${template.name} Bot Token:`, "(".repeat(20).slice(0, 20) + ")")
        const token = await readlineSync("  > ")
        if (token.trim()) {
          imConfig.token = token.trim()
        }
      }

      if (imType === "telegram" && !imConfig.allowedUsers || imConfig.allowedUsers.length === 0) {
        console.log("Telegram User ID (optional, for authentication):", "(".repeat(20).slice(0, 20) + ")")
        const userId = await readlineSync("  > ")
        if (userId.trim()) {
          imConfig.allowedUsers = [parseInt(userId.trim())]
        }
      }

      config.im = imConfig as any
      config.projects = config.projects || {}

      await fs.writeFile(configFile, JSON.stringify(config, null, 2))
      console.log("")
      console.log(`✅ ${template.name} configuration saved to: ${configFile}`)
    } else {
      console.log(`✅ ${template.name} already configured`)
    }

    console.log("")
    console.log("📝 Setup Summary:")
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    console.log(`  Platform: ${template.name}`)
    console.log(`  Type: ${template.type}`)
    
    if (template.configKeys.length > 0) {
      console.log(`  Config keys: ${template.configKeys.join(", ")}`)
      console.log("")
      console.log("🔗 Setup Resources:")
      console.log(`  Bot Setup: ${template.botUrl}`)
      if (template.userIdUrl) {
        console.log(`  Get User ID: ${template.userIdUrl}`)
      }
    }
    
    console.log("")
    console.log("📁 Config file:", configFile)
    console.log("")
    console.log("🚀 Start server:")
    console.log("   opencode serve")
    console.log("")
    console.log("💡 To configure a different platform:")
    console.log(`   opencode init --platform <${Object.keys(IM_TEMPLATES).join("|")}>`)
  },
})

async function selectIMPlatform(): Promise<string> {
  console.log("Select IM platform to configure:")
  console.log("")

  const platforms = Object.entries(IM_TEMPLATES)
  platforms.forEach(([key, template], index) => {
    console.log(`  ${index + 1}. ${template.name.padEnd(12)} ${template.description}`)
  })

  console.log("")
  const choice = await readlineSync("Enter platform number (1-" + platforms.length + "): ")
  const selectedIndex = parseInt(choice) - 1

  if (selectedIndex < 0 || selectedIndex >= platforms.length) {
    throw new Error("Invalid choice")
  }

  return platforms[selectedIndex][0]
}

async function readlineSync(prompt: string): Promise<string> {
  const readline = (await import("readline")).createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise((resolve) => {
    readline.question(prompt, (answer: string) => {
      readline.close()
      resolve(answer)
    })
  })
}

async function loadConfig(configFile: string): Promise<any> {
  try {
    await fs.mkdir(path.dirname(configFile), { recursive: true })
    const content = await fs.readFile(configFile, "utf-8").catch(() => null)
    return content ? JSON.parse(content) : {}
  } catch {
    return {}
  }
}

    switch (config.im.type) {
      case "telegram":
        console.log("✅ Telegram integration configured")
        console.log("")
        console.log("📝 To complete setup:")
        console.log("   1. Create a Telegram bot: https://t.me/BotFather")
        console.log("   2. Get your bot token")
        console.log("   3. Get your user ID: https://t.me/userinfobot")
        console.log("")
        console.log("   Edit config file:")
        console.log(`   ${configFile}`)
        console.log("")
        console.log("   Add your token and user ID:")
        console.log(`   "token": "YOUR_BOT_TOKEN"`)
        console.log(`   "allowedUsers": [${process.env.USER_ID || "YOUR_USER_ID"}]`)
        console.log("")
        console.log("   Example projects:")
        console.log(`   "projects": {`)
        console.log(`     "api": {`)
        console.log(`       "directory": "~/projects/my-api",`)
        console.log(`       "name": "Backend API"`)
        console.log(`     }`)
        console.log(`   }`)
        break
      case "slack":
        console.log("✅ Slack integration configured")
        console.log("   See docs for Slack setup instructions")
        break
    }

    console.log("")
    console.log("🚀 Start the server:")
    console.log("   opencode serve")
    console.log("")
  },
})

async function loadOrCreateConfig(configFile: string, configDir: string): Promise<any> {
  try {
    await fs.mkdir(configDir, { recursive: true })
    const content = await fs.readFile(configFile, "utf-8").catch(() => null)
    
    if (content) {
      return JSON.parse(content)
    }

    const defaultConfig = {
      "$schema": "https://opencode.ai/config.json",
      im: {
        type: "telegram",
        token: "YOUR_BOT_TOKEN",
        maxFileSize: 20971520,
        allowedTypes: ["image/*", "application/pdf", "text/*", "application/json", "application/zip"],
        storagePath: "~/.opencode/im-media",
        cleanupDays: 15,
        allowedUsers: []
      },
      projects: {},
      compaction: {
        auto: true,
        notify: true
      }
    }

    await fs.writeFile(configFile, JSON.stringify(defaultConfig, null, 2))
    console.log("✅ Created default config file")
    
    return defaultConfig
  }
}
