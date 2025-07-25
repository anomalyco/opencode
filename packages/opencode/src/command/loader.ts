import * as fs from "fs/promises"
import * as path from "path"
import matter from "gray-matter"
import { CustomCommand, CommandMetadataSchema } from "./types"
import { App } from "../app/app"
import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"

export class CommandLoader {
  private commands = new Map<string, CustomCommand>()
  private fileWatcher: any // FSWatcher type
  private log = Log.create({ service: "command-loader" })
  
  constructor(private app: App.Info) {}

  async loadCommands(): Promise<void> {
    this.commands.clear()
    
    // Load user commands first (lower priority) - similar to Config.state pattern
    const userCommands = await Filesystem.globUp(
      ".opencode/commands/**/*.md",
      Global.Path.config,
      Global.Path.config
    )
    for (const filePath of userCommands) {
      await this.loadCommandFile(filePath, Global.Path.config, "user")
    }
    
    // Load project commands (higher priority, can override user commands)
    const projectCommands = await Filesystem.globUp(
      ".opencode/commands/**/*.md",
      this.app.path.cwd,
      this.app.path.root
    )
    for (const filePath of projectCommands) {
      await this.loadCommandFile(filePath, this.app.path.cwd, "project")
    }
    
    this.log.info(`Loaded ${this.commands.size} custom commands`)
  }



  private async loadCommandFile(
    filePath: string,
    baseDir: string,
    scope: "project" | "user"
  ): Promise<void> {
    try {
      const content = await Bun.file(filePath).text()
      const { data: metadata, content: rawContent } = matter(content)
      
      // Validate metadata
      const validatedMetadata = CommandMetadataSchema.parse(metadata)
      
      // Calculate command name from file path
      const relativePath = path.relative(
        path.join(baseDir, ".opencode", "commands"),
        filePath
      )
      const pathParts = relativePath.split(path.sep)
      const fileName = pathParts[pathParts.length - 1].replace(/\.md$/, "")
      
      // Build command name with namespace
      let commandName = fileName
      if (pathParts.length > 1) {
        const namespace = pathParts.slice(0, -1).join(":")
        commandName = `${namespace}:${fileName}`
      }
      
      const command: CustomCommand = {
        name: commandName,
        path: filePath,
        scope,
        namespace: pathParts.length > 1 ? pathParts.slice(0, -1).join(":") : undefined,
        metadata: validatedMetadata,
        rawContent,
      }
      
      this.commands.set(commandName, command)
    } catch (error) {
      this.log.error(`Failed to load command from ${filePath}:`, error)
    }
  }

  getCommand(name: string): CustomCommand | undefined {
    return this.commands.get(name)
  }

  getAllCommands(): CustomCommand[] {
    return Array.from(this.commands.values())
  }

  async watchForChanges(): Promise<void> {
    // Implement file watching using chokidar or native fs.watch
    const chokidar = await import("chokidar")
    
    const watchPaths = [
      path.join(process.env.HOME || "", ".opencode", "commands"),
      path.join(this.app.cwd, ".opencode", "commands"),
    ]
    
    this.fileWatcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      depth: 10,
    })
    
    this.fileWatcher.on("all", async (event: string, filePath: string) => {
      if (filePath.endsWith(".md")) {
        Log.info(`Command file ${event}: ${filePath}`)
        await this.loadCommands()
      }
    })
  }

  dispose(): void {
    if (this.fileWatcher) {
      this.fileWatcher.close()
    }
  }
}