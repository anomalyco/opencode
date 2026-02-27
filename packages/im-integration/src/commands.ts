export class CommandHandler {
  constructor(
    private sessionManager: any,
    private adapter: any,
    private config: any,
  ) {
    this.registerCommands()
  }

  private registerCommands(): void {
    this.adapter.registerCommand("/switch_project", this.handleSwitchProject.bind(this))
    this.adapter.registerCommand("/list_projects", this.handleListProjects.bind(this))
    this.adapter.registerCommand("/session_info", this.handleSessionInfo.bind(this))
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

  async handleHelp(chatId: string): Promise<void> {
    const help = `🤖 *OpenCode IM 集成帮助*\n\n*命令：*\n/switch_project - 切换到指定项目\n/list_projects - 列出所有项目\n/session_info - 显示当前会话信息\n/help - 显示此帮助\n\n*会话管理：*\n• 每个 Telegram 聊天自动创建独立会话\n• 切换项目会创建新会话（旧会话保留）\n• 会话自动压缩（基于 token 限制）\n\n*使用方法：*\n• 发送任意消息开始对话\n• OpenCode 会执行你的请求\n• 需要确认时会提示你`

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
