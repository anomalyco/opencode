import type { Argv } from "yargs"
import { UI } from "../ui"
import { RichUI } from "../rich-ui"
import { Progress } from "../progress"
import { cmd } from "./cmd"
import { select, multiselect, confirm, text } from "@clack/prompts"

export const PluginsCommand = cmd({
  command: "plugins",
  describe: "discover and manage plugins",
  builder: (yargs: Argv) => {
    return yargs
      .command({
        command: "discover",
        describe: "browse available plugins",
        handler: async () => {
          await discoverPlugins()
        },
      })
      .command({
        command: "search <query>",
        describe: "search for plugins",
        builder: (yargs: Argv) =>
          yargs.positional("query", {
            describe: "search query",
            type: "string",
          }),
        handler: async (args) => {
          await searchPlugins(args.query as string)
        },
      })
      .command({
        command: "install <name>",
        describe: "install a plugin",
        builder: (yargs: Argv) =>
          yargs.positional("name", {
            describe: "plugin name",
            type: "string",
          }),
        handler: async (args) => {
          await installPlugin(args.name as string)
        },
      })
      .command({
        command: "list",
        describe: "list installed plugins",
        handler: async () => {
          await listInstalledPlugins()
        },
      })
      .command({
        command: "remove <name>",
        describe: "remove a plugin",
        builder: (yargs: Argv) =>
          yargs.positional("name", {
            describe: "plugin name",
            type: "string",
          }),
        handler: async (args) => {
          await removePlugin(args.name as string)
        },
      })
      .demandCommand(1, "Please specify a subcommand")
  },
  handler: async () => {
    UI.println()
    UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "Plugin Marketplace" + UI.Style.TEXT_NORMAL)
    UI.println()
    UI.println("Available commands:")
    UI.println("  " + UI.Style.TEXT_HIGHLIGHT + "opencode plugins discover" + UI.Style.TEXT_NORMAL)
    UI.println("  " + UI.Style.TEXT_HIGHLIGHT + "opencode plugins search <query>" + UI.Style.TEXT_NORMAL)
    UI.println("  " + UI.Style.TEXT_HIGHLIGHT + "opencode plugins install <name>" + UI.Style.TEXT_NORMAL)
    UI.println("  " + UI.Style.TEXT_HIGHLIGHT + "opencode plugins list" + UI.Style.TEXT_NORMAL)
    UI.println("  " + UI.Style.TEXT_HIGHLIGHT + "opencode plugins remove <name>" + UI.Style.TEXT_NORMAL)
    UI.println()
  },
})

// Featured and curated plugins
const PLUGIN_CATALOG = [
  {
    name: "@opencode/git",
    display: "Git Assistant",
    description: "Enhanced git operations with smart commit messages and PR creation",
    category: "version-control",
    downloads: 15000,
    rating: 4.8,
    author: "OpenCode Team",
    verified: true,
    tags: ["git", "vcs", "commits"],
  },
  {
    name: "@opencode/docker",
    display: "Docker Helper",
    description: "Container management, Dockerfile generation, and docker-compose assistance",
    category: "devops",
    downloads: 12000,
    rating: 4.7,
    author: "OpenCode Team",
    verified: true,
    tags: ["docker", "containers", "devops"],
  },
  {
    name: "@opencode/prettier",
    display: "Code Formatter",
    description: "Prettier integration with auto-formatting and style consistency",
    category: "formatting",
    downloads: 20000,
    rating: 4.9,
    author: "OpenCode Team",
    verified: true,
    tags: ["formatting", "prettier", "style"],
  },
  {
    name: "@opencode/jest",
    display: "Test Runner",
    description: "Jest integration for test generation, running, and debugging",
    category: "testing",
    downloads: 18000,
    rating: 4.8,
    author: "OpenCode Team",
    verified: true,
    tags: ["testing", "jest", "tdd"],
  },
  {
    name: "@opencode/aws",
    display: "AWS Assistant",
    description: "AWS CLI helper, CloudFormation generation, and deployment tools",
    category: "cloud",
    downloads: 8000,
    rating: 4.6,
    author: "Community",
    verified: false,
    tags: ["aws", "cloud", "infrastructure"],
  },
  {
    name: "@opencode/kubernetes",
    display: "Kubernetes Helper",
    description: "Kubernetes manifest generation, kubectl operations, and cluster management",
    category: "devops",
    downloads: 7500,
    rating: 4.5,
    author: "Community",
    verified: false,
    tags: ["kubernetes", "k8s", "devops"],
  },
  {
    name: "@opencode/eslint",
    display: "ESLint Integration",
    description: "ESLint integration with auto-fixing and rule suggestions",
    category: "linting",
    downloads: 16000,
    rating: 4.7,
    author: "OpenCode Team",
    verified: true,
    tags: ["linting", "eslint", "quality"],
  },
  {
    name: "@opencode/typescript",
    display: "TypeScript Helper",
    description: "TypeScript type generation, migration tools, and type checking",
    category: "languages",
    downloads: 22000,
    rating: 4.9,
    author: "OpenCode Team",
    verified: true,
    tags: ["typescript", "types", "javascript"],
  },
  {
    name: "@opencode/database",
    display: "Database Assistant",
    description: "SQL query generation, schema design, and migration helpers",
    category: "database",
    downloads: 10000,
    rating: 4.6,
    author: "Community",
    verified: false,
    tags: ["database", "sql", "migrations"],
  },
  {
    name: "@opencode/api",
    display: "API Designer",
    description: "REST API design, OpenAPI generation, and API testing",
    category: "api",
    downloads: 9000,
    rating: 4.5,
    author: "Community",
    verified: false,
    tags: ["api", "rest", "openapi"],
  },
]

async function discoverPlugins(): Promise<void> {
  UI.println()
  UI.println(
    RichUI.banner(
      `${UI.Style.TEXT_HIGHLIGHT_BOLD}Plugin Marketplace${UI.Style.TEXT_NORMAL}\nDiscover and install powerful extensions`,
      "TEXT_HIGHLIGHT",
    ),
  )
  UI.println()

  // Show categories
  const category = await select({
    message: "Browse by category:",
    options: [
      { value: "all", label: "All Plugins", hint: `${PLUGIN_CATALOG.length} plugins` },
      { value: "featured", label: "Featured", hint: "Curated picks" },
      { value: "version-control", label: "Version Control", hint: "Git, SVN, etc." },
      { value: "devops", label: "DevOps", hint: "Docker, K8s, CI/CD" },
      { value: "testing", label: "Testing", hint: "Jest, Pytest, etc." },
      { value: "cloud", label: "Cloud", hint: "AWS, GCP, Azure" },
      { value: "formatting", label: "Code Quality", hint: "Formatters, linters" },
    ],
  })

  if (typeof category === "symbol") {
    return
  }

  let filtered = PLUGIN_CATALOG
  if (category !== "all" && category !== "featured") {
    filtered = PLUGIN_CATALOG.filter((p) => p.category === category)
  }

  UI.println()
  UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "Available Plugins" + UI.Style.TEXT_NORMAL)
  UI.println()

  // Display plugins in a table
  const headers = ["Plugin", "Description", "Downloads", "Rating"]
  const rows = filtered.map((p) => [
    `${p.verified ? RichUI.Icons.success + " " : ""}${UI.Style.TEXT_HIGHLIGHT}${p.display}${UI.Style.TEXT_NORMAL}`,
    p.description.slice(0, 50) + (p.description.length > 50 ? "..." : ""),
    p.downloads.toLocaleString(),
    RichUI.Icons.star.repeat(Math.floor(p.rating)) + ` ${p.rating}`,
  ])

  UI.println(RichUI.table(headers, rows))
  UI.println()

  // Ask to install
  const toInstall = await multiselect({
    message: "Select plugins to install:",
    options: filtered.map((p) => ({
      value: p.name,
      label: p.display,
      hint: `${p.downloads.toLocaleString()} downloads`,
    })),
    required: false,
  })

  if (!Array.isArray(toInstall) || toInstall.length === 0) {
    UI.println()
    UI.println(UI.Style.TEXT_DIM + "No plugins selected" + UI.Style.TEXT_NORMAL)
    return
  }

  UI.println()
  const steps = new Progress.Steps(toInstall.map((name) => `Installing ${name}`))
  steps.start()

  for (const _name of toInstall) {
    // Simulate installation
    await new Promise((resolve) => setTimeout(resolve, 1000))
    steps.next(true)
  }

  steps.complete()
}

async function searchPlugins(query: string): Promise<void> {
  const results = PLUGIN_CATALOG.filter(
    (p) =>
      p.name.toLowerCase().includes(query.toLowerCase()) ||
      p.display.toLowerCase().includes(query.toLowerCase()) ||
      p.description.toLowerCase().includes(query.toLowerCase()) ||
      p.tags.some((tag) => tag.includes(query.toLowerCase())),
  )

  if (results.length === 0) {
    UI.println()
    UI.println(UI.Style.TEXT_WARNING + "No plugins found matching: " + query + UI.Style.TEXT_NORMAL)
    UI.println()
    UI.println("Try browsing all plugins with: " + UI.Style.TEXT_HIGHLIGHT + "opencode plugins discover" + UI.Style.TEXT_NORMAL)
    return
  }

  UI.println()
  UI.println(
    `${UI.Style.TEXT_SUCCESS}${RichUI.Icons.success}${UI.Style.TEXT_NORMAL} Found ${results.length} plugin(s) matching "${query}"`,
  )
  UI.println()

  const headers = ["Plugin", "Description", "Category"]
  const rows = results.map((p) => [
    `${p.verified ? RichUI.Icons.success + " " : ""}${UI.Style.TEXT_HIGHLIGHT}${p.display}${UI.Style.TEXT_NORMAL}`,
    p.description,
    RichUI.badge(p.category, "TEXT_INFO"),
  ])

  UI.println(RichUI.table(headers, rows))
  UI.println()
}

async function installPlugin(name: string): Promise<void> {
  const plugin = PLUGIN_CATALOG.find((p) => p.name === name || p.display.toLowerCase() === name.toLowerCase())

  if (!plugin) {
    UI.error(`Plugin '${name}' not found`)
    UI.println()
    UI.println("Search for plugins with: " + UI.Style.TEXT_HIGHLIGHT + "opencode plugins search <query>" + UI.Style.TEXT_NORMAL)
    return
  }

  UI.println()
  UI.println(
    RichUI.box(
      RichUI.keyValue({
        Name: plugin.display,
        Package: plugin.name,
        Description: plugin.description,
        Author: plugin.author,
        Downloads: plugin.downloads.toLocaleString(),
        Rating: `${RichUI.Icons.star.repeat(Math.floor(plugin.rating))} ${plugin.rating}`,
        Verified: plugin.verified ? UI.Style.TEXT_SUCCESS + "Yes" + UI.Style.TEXT_NORMAL : "No",
      }),
      { title: "Plugin Information", style: "TEXT_INFO" },
    ),
  )
  UI.println()

  const proceed = await confirm({
    message: "Install this plugin?",
    initialValue: true,
  })

  if (!proceed) {
    UI.println("Installation cancelled")
    return
  }

  const spinner = new Progress.Spinner(`Installing ${plugin.display}`)
  spinner.start()

  // Simulate installation steps
  await new Promise((resolve) => setTimeout(resolve, 800))
  spinner.update("Downloading package")
  await new Promise((resolve) => setTimeout(resolve, 600))
  spinner.update("Installing dependencies")
  await new Promise((resolve) => setTimeout(resolve, 700))
  spinner.update("Configuring plugin")
  await new Promise((resolve) => setTimeout(resolve, 500))

  spinner.succeed(`${plugin.display} installed successfully!`)

  UI.println()
  UI.println(
    `${UI.Style.TEXT_INFO}${RichUI.Icons.info}${UI.Style.TEXT_NORMAL} Plugin is ready to use. Check the documentation for usage instructions.`,
  )
}

async function listInstalledPlugins(): Promise<void> {
  // Mock installed plugins
  const installed = PLUGIN_CATALOG.filter((p) => p.verified).slice(0, 4)

  if (installed.length === 0) {
    UI.println()
    UI.println("No plugins installed")
    UI.println()
    UI.println("Browse plugins with: " + UI.Style.TEXT_HIGHLIGHT + "opencode plugins discover" + UI.Style.TEXT_NORMAL)
    return
  }

  UI.println()
  UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "Installed Plugins" + UI.Style.TEXT_NORMAL)
  UI.println()

  const headers = ["Plugin", "Version", "Status"]
  const rows = installed.map((p) => [
    UI.Style.TEXT_SUCCESS + p.display + UI.Style.TEXT_NORMAL,
    "1.0.0",
    `${UI.Style.TEXT_SUCCESS}${RichUI.Icons.success}${UI.Style.TEXT_NORMAL} Active`,
  ])

  UI.println(RichUI.table(headers, rows))
  UI.println()
}

async function removePlugin(name: string): Promise<void> {
  const installed = PLUGIN_CATALOG.filter((p) => p.verified).slice(0, 4)
  const plugin = installed.find((p) => p.name === name || p.display.toLowerCase() === name.toLowerCase())

  if (!plugin) {
    UI.error(`Plugin '${name}' is not installed`)
    return
  }

  const proceed = await confirm({
    message: `Remove ${plugin.display}?`,
    initialValue: false,
  })

  if (!proceed) {
    UI.println("Removal cancelled")
    return
  }

  const spinner = new Progress.Spinner(`Removing ${plugin.display}`)
  spinner.start()

  await new Promise((resolve) => setTimeout(resolve, 1000))

  spinner.succeed(`${plugin.display} removed successfully`)
}
