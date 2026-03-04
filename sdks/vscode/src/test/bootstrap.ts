import { initRunDir, captureFailure } from './helpers/evidence'

const runDirPromise = initRunDir()

const logs: string[] = []
const origLog = console.log.bind(console)
console.log = (...args: any[]) => {
  try { logs.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')) } catch(e) {}
  origLog(...args)
}
const origError = console.error.bind(console)
console.error = (...args: any[]) => {
  try { logs.push('ERROR: ' + args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')) } catch(e) {}
  origError(...args)
}

;(global as any).__EXT_LOGS__ = logs

export const mochaHooks = {
  async afterEach(this: any) {
    const t: any = this && this.currentTest
    if (!t) return
    if (t.state === 'failed') {
      const runDir = await runDirPromise
      try {
        await captureFailure(t, t.err, runDir)
      } catch (e) {
        // do not mask original failure
      }
    }
  }
}

export {}
