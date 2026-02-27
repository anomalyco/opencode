export class QuestionHandler {
  private processed = new Set<string>()

  constructor(
    private adapter: any,
    private opencode: any,
  ) {
    this.startPolling()
  }

  private async startPolling(): Promise<void> {
    while (true) {
      await this.sleep(5000)

      const questions = await this.opencode.client.question.list()

      for (const question of questions) {
        if (!this.processed.has(question.id)) {
          await this.handleQuestion(question)
          this.processed.add(question.id)
        }
      }
    }
  }

  private async handleQuestion(question: any): Promise<void> {
    const session = this.getSessionBySessionID(question.sessionID)
    if (!session) return

    const q = question.questions[0]
    const formatted = {
      id: question.id,
      header: q.header,
      text: q.question,
      options: q.options,
      type: "blocking",
    }

    const response = await this.adapter.presentQuestion(session.chatId, formatted)

    if (response.answered) {
      if (response.rejected) {
        await this.adapter.rejectQuestion(question.id)
      } else {
        await this.adapter.answerQuestion(question.id, response.answers!)
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private getSessionBySessionID(sessionId: string): any {
    return null
  }

  async answerQuestion(questionId: string, answers: string[]): Promise<void> {
    await this.opencode.client.question.reply({
      path: { requestID: questionId },
      body: { answers },
    })
  }

  async rejectQuestion(questionId: string): Promise<void> {
    await this.opencode.client.question.reject({
      path: { requestID: questionId },
    })
  }
}
