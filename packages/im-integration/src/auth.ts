export class AuthHandler {
  private allowedUsers: Set<number>

  constructor(private config: any) {
    this.allowedUsers = new Set(config.im?.allowedUsers || [])
  }

  isAllowed(userId: number): boolean {
    if (this.allowedUsers.size === 0) {
      return true
    }
    return this.allowedUsers.has(userId)
  }

  async handleUnauthorized(chatId: number, userId: number, adapter: any): Promise<void> {
    await adapter.sendMessage(chatId, `❌ 你没有权限使用此 Bot。\n\n请联系管理员申请访问权限。`)
  }
}
