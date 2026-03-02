export class CommandHandler {
  private onConfigUpdate?: () => void

  constructor(
    private sessionManager: any,
    private adapter: any,
    private config: any,
  ) {
    this.registerCommands()
  }

  setOnConfigUpdate(callback: () => void): void {
    this.onConfigUpdate = callback
  }

  private registerCommands(): void {
    this.adapter.registerCommand("/switch_project", this.handleSwitchProject.bind(this))
    this.adapter.registerCommand("/list_projects", this.handleListProjects.bind(this))
    this.adapter.registerCommand("/new_project", this.handleNewProject.bind(this))
    this.adapter.registerCommand("/list_directories", this.handleListDirectories.bind(this))
    this.adapter.registerCommand("/session_info", this.handleSessionInfo.bind(this))
    this.adapter.registerCommand("/reset_session", this.handleResetSession.bind(this))
    this.adapter.registerCommand("/help", this.handleHelp.bind(this))
  }

  async handleSwitchProject(chatId: string, args: string[]): Promise<void> {
    const projects = this.config.projects || {}

    if (args.length === 0) {
      let message = "📁 *可用项目：*\n\n"
      for (const [key, project] of Object.entries(projects)) {
        message += `• /switch_project \`${key}\` - ${project.name || key}\n`
        message += `  📂 ${project.directory}\n\n`
      }
      await this.adapter.sendMessage(chatId, message)
      return
    }

    const projectKey = args[0]
    const project = projects[projectKey]

    if (!project) {
      await this.adapter.sendMessage(chatId, `❌ 项目 "${projectKey}" 不存在。使用 /list_projects 查看可用项目。`)
      return
    }

    await this.sessionManager.switchProject(chatId, project.directory)

    await this.adapter.sendMessage(
      chatId,
      `✅ 已切换到项目: ${project.name || projectKey}\n\n📂 路径: ${project.directory}\n💬 新会话已创建`,
    )
  }

  async handleListProjects(chatId: string): Promise<void> {
    const projects = this.config.projects || {}
    const stats = this.sessionManager.getStats(chatId)

    let message = "📁 *项目列表：*\n\n"
    for (const [key, project] of Object.entries(projects)) {
      const current = stats.project === project.directory ? " ✅ 当前" : ""
      message += `${current} • \`${key}\` - ${project.name || key}\n`
      message += `  📂 ${project.directory}\n\n`
    }

    await this.adapter.sendMessage(chatId, message)
  }

  async handleSessionInfo(chatId: string): Promise<void> {
    const stats = this.sessionManager.getStats(chatId)

    if (!stats.exists) {
      await this.adapter.sendMessage(chatId, "❌ 当前没有活动会话")
      return
    }

    const projectName = this.getProjectName(stats.project!)

    let message = `📊 *会话信息*\n\n🆔 会话 ID: ${stats.sessionId?.slice(0, 8)}...
📁 项目: ${projectName}
📂 路径: ${stats.project}
💬 消息数: ${stats.messageCount}
📎 媒体数: ${stats.mediaCount}
🕐 创建时间: ${new Date(stats.createdAt!).toLocaleString("zh-CN")}`

    if (stats.isCompacted) {
      message += `\n🗜️ 最后压缩: ${new Date(stats.compactedAt!).toLocaleString("zh-CN")}`
    }

    await this.adapter.sendMessage(chatId, message)
  }

  async handleResetSession(chatId: string): Promise<void> {
    this.sessionManager.clearSession(chatId)
    await this.adapter.sendMessage(chatId, "✅ 会话已重置。下次发送消息时将创建新会话。")
  }

  async handleListDirectories(chatId: string, args: string[]): Promise<void> {
    const fs = await import("fs/promises")
    const path = await import("path")
    const os = await import("os")

    const homeDir = os.homedir()

    let targetPath = args[0]

    if (!targetPath) {
      const commonDirs = [
        { key: "Desktop", path: path.join(homeDir, "Desktop"), emoji: "📁" },
        { key: "Documents", path: path.join(homeDir, "Documents"), emoji: "📄" },
        { key: "Downloads", path: path.join(homeDir, "Downloads"), emoji: "⬇️" },
        { key: "Desktop/openCode", path: path.join(homeDir, "Desktop", "openCode"), emoji: "💻" },
        { key: "Desktop/AIWork", path: path.join(homeDir, "Desktop", "AIWork"), emoji: "🤖" },
      ]

      let message = "📂 *常用目录：*\n\n使用 `/list_directories <路径>` 查看子目录\n\n"

      for (const dir of commonDirs) {
        const exists = await fs
          .access(dir.path)
          .then(() => "✅")
          .catch(() => "❌")
        message += `${exists} ${dir.emoji} \`${dir.key}\`\n`
        message += `   ${dir.path.replace(homeDir, "~")}\n\n`
      }

      message += "💡 提示：\n• 使用 `/list_directories ~/Desktop` 查看桌面子目录\n• 使用 `/new_project <路径>` 添加项目"

      await this.adapter.sendMessage(chatId, message)
      return
    }

    targetPath = targetPath.replace(/^~/, homeDir).replace(/^~\//, `${homeDir}/`)

    try {
      await fs.access(targetPath)
    } catch {
      await this.adapter.sendMessage(chatId, `❌ 目录不存在: ${targetPath.replace(homeDir, "~")}`)
      return
    }

    const entries = await fs.readdir(targetPath, { withFileTypes: true })
    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name))

    if (dirs.length === 0) {
      await this.adapter.sendMessage(chatId, `📂 目录为空或没有子目录\n\n${targetPath.replace(homeDir, "~")}`)
      return
    }

    let message = `📂 *${targetPath.replace(homeDir, "~")}* 下的目录：\n\n`
    message += `共 ${dirs.length} 个目录\n\n`

    for (const dir of dirs.slice(0, 30)) {
      message += `📁 ${dir.name}\n`
    }

    if (dirs.length > 30) {
      message += `\n... 还有 ${dirs.length - 30} 个目录`
    }

    await this.adapter.sendMessage(chatId, message)
  }

  async handleNewProject(chatId: string, args: string[]): Promise<void> {
    if (args.length === 0) {
      await this.adapter.sendMessage(
        chatId,
        '❌ 请提供项目路径。\n\n用法: /new_project <目录路径> [项目名称]\n\n示例:\n/new_project ~/Desktop/MyProject "My Project"\n/new_project ~/Desktop/AIWork',
      )
      return
    }

    const directory = args[0]
      .replace(/^~/, process.env.HOME || require("os").homedir())
      .replace(/^~\//, `${process.env.HOME || require("os").homedir()}/`)

    const projectName = args[1] || directory.split("/").pop() || "New Project"

    const fs = await import("fs/promises")

    try {
      await fs.access(directory)
    } catch {
      await this.adapter.sendMessage(chatId, `❌ 目录不存在: ${directory}`)
      return
    }

    const projectKey = projectName.toLowerCase().replace(/[^a-z0-9]/g, "_")

    if (this.config.projects?.[projectKey]) {
      await this.adapter.sendMessage(
        chatId,
        `❌ 项目 "${projectKey}" 已存在。\n\n请使用 /switch_project ${projectKey} 切换到该项目。`,
      )
      return
    }

    const newProject = {
      name: projectName,
      directory,
    }

    this.config.projects = this.config.projects || {}
    this.config.projects[projectKey] = newProject

    await this.adapter.sendMessage(
      chatId,
      `✅ 项目已添加: ${projectName}\n\n📂 路径: ${directory}\n🆔 Key: \`${projectKey}\`\n\n使用 /switch_project ${projectKey} 切换到此项目`,
    )

    if (this.onConfigUpdate) {
      this.onConfigUpdate()
    }
  }

  async handleHelp(chatId: string): Promise<void> {
    const help = `🤖 *OpenCode IM 集成帮助*\n\n*命令：*\n/switch_project - 切换到指定项目\n/list_projects - 列出所有项目\n/new_project - 添加新项目\n/list_directories - 列出可用目录\n/session_info - 显示当前会话信息\n/reset_session - 重置当前会话\n/help - 显示此帮助\n\n*会话管理：*\n• 每个 Telegram 聊天自动创建独立会话\n• 切换项目会创建新会话（旧会话保留）\n• 会话自动压缩（基于 token 限制）\n\n*使用方法：*\n• 发送任意消息开始对话\n• OpenCode 会执行你的请求\n• 需要确认时会提示你`

    await this.adapter.sendMessage(chatId, help)
  }

  async handleListDirectories(chatId: string, args: string[]): Promise<void> {
    const fs = await import("fs/promises")
    const path = await import("path")
    const os = await import("os")

    const homeDir = os.homedir()

    let targetPath = args[0]

    if (!targetPath) {
      // 列出常用目录
      const commonDirs = [
        { key: "Desktop", path: path.join(homeDir, "Desktop"), emoji: "📁" },
        { key: "Documents", path: path.join(homeDir, "Documents"), emoji: "📄" },
        { key: "Downloads", path: path.join(homeDir, "Downloads"), emoji: "⬇️" },
        { key: "Desktop/openCode", path: path.join(homeDir, "Desktop", "openCode"), emoji: "💻" },
        { key: "Desktop/AIWork", path: path.join(homeDir, "Desktop", "AIWork"), emoji: "🤖" },
      ]

      let message = "📂 *常用目录：*\n\n使用 `/list_directories <路径>` 查看子目录\n\n"

      for (const dir of commonDirs) {
        const exists = await fs
          .access(dir.path)
          .then(() => "✅")
          .catch(() => "❌")
        message += `${exists} ${dir.emoji} \`${dir.key}\`\n`
        message += `   ${dir.path.replace(homeDir, "~")}\n\n`
      }

      message += "💡 提示：\n• 使用 `/list_directories ~/Desktop` 查看桌面子目录\n• 使用 `/new_project <路径>` 添加项目"

      await this.adapter.sendMessage(chatId, message)
      return
    }

    // 展开路径
    targetPath = targetPath.replace(/^~/, homeDir).replace(/^~\//, `${homeDir}/`)

    try {
      await fs.access(targetPath)
    } catch {
      await this.adapter.sendMessage(chatId, `❌ 目录不存在: ${targetPath.replace(homeDir, "~")}`)
      return
    }

    // 列出子目录
    const entries = await fs.readdir(targetPath, { withFileTypes: true })
    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name))

    if (dirs.length === 0) {
      await this.adapter.sendMessage(chatId, `📂 目录为空或没有子目录\n\n${targetPath.replace(homeDir, "~")}`)
      return
    }

    let message = `📂 *${targetPath.replace(homeDir, "~")}* 下的目录：\n\n`
    message += `共 ${dirs.length} 个目录\n\n`

    for (const dir of dirs.slice(0, 30)) {
      message += `📁 ${dir.name}\n`
    }

    if (dirs.length > 30) {
      message += `\n... 还有 ${dirs.length - 30} 个目录`
    }

    await this.adapter.sendMessage(chatId, message)
  }

  async handleNewProject(chatId: string, args: string[]): Promise<void> {
    if (args.length === 0) {
      await this.adapter.sendMessage(
        chatId,
        '❌ 请提供项目路径。\n\n用法: /new_project <目录路径> [项目名称]\n\n示例:\n/new_project ~/Desktop/MyProject "My Project"\n/new_project ~/Desktop/AIWork',
      )
      return
    }

    const directory = args[0]
      .replace(/^~/, process.env.HOME || require("os").homedir())
      .replace(/^~\//, `${process.env.HOME || require("os").homedir()}/`)

    const projectName = args[1] || directory.split("/").pop() || "New Project"

    const fs = await import("fs/promises")

    try {
      await fs.access(directory)
    } catch {
      await this.adapter.sendMessage(chatId, `❌ 目录不存在: ${directory}`)
      return
    }

    const projectKey = projectName.toLowerCase().replace(/[^a-z0-9]/g, "_")

    if (this.config.projects?.[projectKey]) {
      await this.adapter.sendMessage(
        chatId,
        `❌ 项目 "${projectKey}" 已存在。\n\n请使用 /switch_project ${projectKey} 切换到该项目。`,
      )
      return
    }

    const newProject = {
      name: projectName,
      directory,
    }

    this.config.projects = this.config.projects || {}
    this.config.projects[projectKey] = newProject

    await this.adapter.sendMessage(
      chatId,
      `✅ 项目已添加: ${projectName}\n\n📂 路径: ${directory}\n🆔 Key: \`${projectKey}\`\n\n使用 /switch_project ${projectKey} 切换到此项目`,
    )

    if (this.onConfigUpdate) {
      this.onConfigUpdate()
    }
  }

  async handleHelp(chatId: string): Promise<void> {
    const help = `🤖 *OpenCode IM 集成帮助*\n\n*命令：*\n/switch_project - 切换到指定项目\n/list_projects - 列出所有项目\n/new_project - 添加新项目\n/list_directories - 列出可用目录\n/session_info - 显示当前会话信息\n/reset_session - 重置当前会话\n/help - 显示此帮助\n\n*会话管理：*\n• 每个 Telegram 聊天自动创建独立会话\n• 切换项目会创建新会话（旧会话保留）\n• 会话自动压缩（基于 token 限制）\n\n*使用方法：*\n• 发送任意消息开始对话\n• OpenCode 会执行你的请求\n• 需要确认时会提示你`

    await this.adapter.sendMessage(chatId, help)
  }

  private getProjectName(dir: string): string {
    const projects = this.config.projects || {}
    for (const [key, project] of Object.entries(projects)) {
      if (project.directory === dir) {
        return project.name || key
      }
    }
    return dir
  }
}
