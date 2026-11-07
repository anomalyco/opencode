import { parentPort, workerData } from "node:worker_threads"
import { ClaudeIO } from "./io.js"

const helper: (...args: string[]) => Promise<unknown> =
  ClaudeIO.helpers[workerData.name as keyof typeof ClaudeIO.helpers]
try {
  parentPort?.postMessage({ value: await helper(...workerData.args) })
} catch (error) {
  parentPort?.postMessage({ error })
}
