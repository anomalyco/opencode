import {
  type JobContext,
  type JobProcess,
  WorkerOptions,
  cli,
  defineAgent,
  inference,
  metrics,
  voice,
} from '@livekit/agents'
import * as livekit from '@livekit/agents-plugin-livekit'
import * as silero from '@livekit/agents-plugin-silero'
import { fileURLToPath } from 'node:url'

class OpenCodeAssistant extends voice.Agent {
  constructor() {
    super({
      instructions: `You are OpenCode's voice assistant. The user is interacting with you via voice.
      You help with coding tasks, answer questions about code, and assist with development workflows.
      Your responses are concise and conversational, without complex formatting or emojis.
      You are helpful, friendly, and technically accurate.`,
    })
  }
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load()
  },
  entry: async (ctx: JobContext) => {
    const session = new voice.AgentSession({
      stt: new inference.STT({
        model: 'deepgram/nova-2',
        language: 'en',
      }),
      llm: new inference.LLM({
        model: 'openai/gpt-4o-mini',
      }),
      tts: new inference.TTS({
        model: 'cartesia/sonic-3',
        voice: '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc',
      }),
      vad: ctx.proc.userData.vad! as silero.VAD,
    })

    const usageCollector = new metrics.UsageCollector()
    session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
      metrics.logMetrics(ev.metrics)
      usageCollector.collect(ev.metrics)
    })

    const logUsage = async () => {
      const summary = usageCollector.getSummary()
      console.log(`Usage: ${JSON.stringify(summary)}`)
    }

    ctx.addShutdownCallback(logUsage)

    await session.start({
      agent: new OpenCodeAssistant(),
      room: ctx.room,
    })

    await ctx.connect()
  },
})

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }))
