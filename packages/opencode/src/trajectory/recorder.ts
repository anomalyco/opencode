import fs from "fs"
import path from "path"
import type { Trajectory } from "./types"
import { TrajectoryConfig } from "./config"

type Recorder = {
  id: string
  path: string
  buffer: Trajectory.Event[]
  stream: boolean
  options: TrajectoryConfig.Options
  disabled: boolean
}

export namespace TrajectoryRecorder {
  const recorders = new Map<string, Recorder>()

  export function start(
    sessionID: string,
    options: {
      agent: string
      model: { provider: string; id: string }
      filePath?: string
    },
  ): void {
    if (recorders.has(sessionID)) return
    const cfg = TrajectoryConfig.get()
    const target = options.filePath ?? resolvePath(sessionID, options.agent, options.model, cfg)
    const disabled = cfg.enabled === false
    const rec: Recorder = {
      id: sessionID,
      path: target,
      buffer: [],
      stream: false,
      options: cfg,
      disabled,
    }
    recorders.set(sessionID, rec)
  }

  export async function record(sessionID: string, event: Trajectory.Event): Promise<void> {
    const rec = recorders.get(sessionID)
    if (!rec) throw new Error(`Trajectory recorder not started for session ${sessionID}`)
    if (rec.disabled) return
    rec.buffer.push(event)
    if (shouldFlush(rec)) await flush(rec)
  }

  export async function stop(sessionID: string): Promise<void> {
    const rec = recorders.get(sessionID)
    if (!rec) return
    if (!rec.disabled) await flush(rec)
    recorders.delete(sessionID)
  }

  export function isRecording(sessionID: string): boolean {
    return recorders.has(sessionID)
  }

  export function markStreamStart(sessionID: string): void {
    const rec = recorders.get(sessionID)
    if (!rec) throw new Error(`Trajectory recorder not started for session ${sessionID}`)
    rec.stream = true
  }

  export async function markStreamEnd(sessionID: string): Promise<void> {
    const rec = recorders.get(sessionID)
    if (!rec) throw new Error(`Trajectory recorder not started for session ${sessionID}`)
    rec.stream = false
    if (rec.disabled) return
    if (rec.options.flushStrategy === "end_of_stream" || rec.buffer.length >= rec.options.bufferSize) {
      await flush(rec)
    }
  }

  function resolvePath(
    sessionID: string,
    agent: string,
    model: { provider: string; id: string },
    cfg: TrajectoryConfig.Options,
  ) {
    const base = path.isAbsolute(cfg.outputPath) ? cfg.outputPath : path.join(process.cwd(), cfg.outputPath)
    const filename = TrajectoryConfig.resolveFilename(sessionID, {
      agent,
      model: model.id,
      timestamp: Date.now(),
    })
    return path.join(base, filename)
  }

  function createFile(filePath: string) {
    const dir = path.dirname(filePath)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(filePath, "", { flag: "a" })
  }

  function shouldFlush(rec: Recorder) {
    if (rec.options.flushStrategy === "immediate") return true
    if (!rec.stream && rec.options.flushStrategy === "end_of_stream") return true
    return rec.buffer.length >= rec.options.bufferSize
  }

  async function flush(rec: Recorder) {
    if (rec.buffer.length === 0) return
    createFile(rec.path)
    const lines = rec.buffer.map((item) => JSON.stringify(item))
    rec.buffer.length = 0
    const chunk = lines.join("\n") + "\n"
    await fs.promises.appendFile(rec.path, chunk)
  }
}
