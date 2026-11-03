// Adapted from the iOS app's GPT-Live QuietGate. Nothing goes out while the user talks: results wait until they have
// been quiet for two seconds, with no cap. The microphone counts as the user talking only while their words were
// transcribed in the last six seconds, so room noise can't hold results forever.
export class VoiceGates {
  private wordsAt = -Infinity
  private voiceAt = -Infinity
  private assistantAt = -Infinity
  private assistantSpeaking = false
  /** When the agent's current run of speech began. */
  private runAt = -Infinity
  private answerAt = -Infinity

  /** The user's words were transcribed. */
  words() {
    this.wordsAt = Date.now()
  }

  /** The microphone's level, several times a second. */
  voice(speaking: boolean) {
    if (speaking) this.voiceAt = Date.now()
  }

  assistant(speaking: boolean) {
    if (speaking && !this.assistantSpeaking) this.runAt = Date.now()

    if (speaking || this.assistantSpeaking) this.assistantAt = Date.now()
    this.assistantSpeaking = speaking
  }

  /** The agent is speaking now. */
  get speaking() {
    return this.assistantSpeaking
  }

  /** The user's words were transcribed since the agent began its current speech: they're talking over it. */
  get talkingOver() {
    return this.assistantSpeaking && this.wordsAt > this.runAt
  }

  /** A delegator answer is on its way to the voice agent. */
  answer() {
    this.answerAt = Date.now()
  }

  /** How long nobody has spoken, counting a line just sent to the agent as speech about to start. */
  quiet() {
    if (this.assistantSpeaking) return 0
    const now = Date.now()
    const voice = now - this.wordsAt < 6000 ? this.voiceAt : -Infinity

    return now - Math.max(this.wordsAt, voice, this.assistantAt, this.answerAt)
  }

  /**
   * For context the agent should know but not answer, such as a move to another session: like `delay`, and while a
   * reply to the user's latest words is due, until it starts or 8 s after those words, as on iOS. Cutting that reply off
   * would cost the user their turn.
   */
  context() {
    const due = this.wordsAt > this.assistantAt ? 8000 - (Date.now() - this.wordsAt) : 0

    return Math.max(this.delay(), due)
  }

  delay() {
    const now = Date.now()
    const heard = now - this.wordsAt < 6000 ? Math.max(this.wordsAt, this.voiceAt) : this.wordsAt
    const user = 2000 - (now - heard)
    const assistant = this.assistantSpeaking ? 900 : 900 - (now - this.assistantAt)
    // A delegator answer gets time to start; once it plays, the agent's own speech holds results.
    const answer = 1200 - (now - this.answerAt)

    return Math.max(0, user, assistant, answer)
  }
}
