// Adapted from voice-lab's QuietGate. User speech is never subject to the
// chatter cap; a pending result may interrupt only the agent after five seconds.
export class VoiceGates {
  private userAt = -Infinity
  private assistantAt = -Infinity
  private userSpeaking = false
  private assistantSpeaking = false
  private answerAt = -Infinity
  private answerStarted = false
  private heldAt?: number

  user(speaking: boolean) {
    if (speaking || this.userSpeaking) this.userAt = Date.now()
    this.userSpeaking = speaking
  }

  assistant(speaking: boolean) {
    if (speaking || this.assistantSpeaking) this.assistantAt = Date.now()
    this.assistantSpeaking = speaking

    if (speaking && Date.now() - this.answerAt < 1200) this.answerStarted = true
  }

  answer() {
    this.answerAt = Date.now()
    this.answerStarted = false
  }

  released() {
    this.heldAt = undefined
  }

  delay() {
    const now = Date.now()
    this.heldAt ??= now

    if (this.userSpeaking) return 900
    const user = (this.userAt > this.assistantAt ? 1500 : 900) - (now - this.userAt)

    if (user > 0) return user
    const answer = (this.answerStarted ? 15_000 : 1200) - (now - this.answerAt)

    if (answer > 0 && (!this.answerStarted || this.assistantSpeaking)) return answer

    if (now - this.heldAt >= 5000) return 0

    return Math.max(0, this.assistantSpeaking ? 900 : 900 - (now - this.assistantAt))
  }
}
