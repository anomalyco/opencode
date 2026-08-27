const assert = require("node:assert/strict")
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const capture = require(process.argv[4] ?? "../native/capture.win32.node")
const node = workerData?.node ?? process.argv[3]
const launch = (source) => ({ executable: node, args: ["-e", source], overlapped: !process.versions.bun })

async function main() {
  if (!isMainThread) {
    const child = capture.start(launch("setTimeout(()=>{},5000)"))
    child.readStdout().catch(() => {})
    child.readStderr().catch(() => {})
    parentPort.postMessage(child.pid)
    return
  }
  if (process.argv[2] === "getter") {
    assert.throws(
      () =>
        capture.start({
          ...launch(""),
          get cwd() {
            throw new Error("getter exception")
          },
        }),
      /getter exception/,
    )
    console.log("getter passed")
    return
  }
  if (process.argv[2] === "reentry") {
    const child = capture.start(launch("require('fs').writeSync(1,'tail')"))
    try {
      Object.defineProperty(Uint8Array.prototype, "then", {
        configurable: true,
        get() {
          delete Uint8Array.prototype.then
          child.close()
          return undefined
        },
      })
      assert.equal(Buffer.from(await child.readStdout()).toString(), "tail")
      await child.exited
    } finally {
      delete Uint8Array.prototype.then
      child.close()
    }
    console.log("reentry passed")
    return
  }
  if (process.argv[2] === "cancelled-write") {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "process-cancelled-write-"))
    let cancelled = 0
    try {
      for (const delay of [0, 1, 5, 15]) {
        const report = path.join(directory, `${delay}.json`)
        const child = capture.start({
          executable: path.resolve(__dirname, "../native/cancelled-writer.exe"),
          args: [String(delay), report],
          overlapped: true,
        })
        const captureStarted = performance.now()
        try {
          assert.equal(await child.exited, 0)
          assert(
            performance.now() - captureStarted < 2000,
            "Capture waited for a retained writer after its pending write was cancelled",
          )
          const chunks = []
          for (;;) {
            const bytes = await child.readStdout()
            if (bytes === null) break
            chunks.push(bytes)
          }
          const bytes = Buffer.concat(chunks)
          assert.equal(bytes.subarray(0, 5).toString(), "ROOT\n")
          assert(bytes.subarray(5).every((byte) => byte === 97))
          const started = performance.now()
          for (;;) {
            const result = await fs.readFile(report, "utf8").then(
              (text) => JSON.parse(text),
              () => undefined,
            )
            if (result) {
              assert.equal(result.started, 997)
              assert([0, 995, 109].includes(result.result))
              process.kill(result.pid, 0)
              if (result.result === 995) cancelled++
              break
            }
            assert(performance.now() - started < 2000, "Descendant did not finish its cancelled write")
            await new Promise((resolve) => setImmediate(resolve))
          }
        } finally {
          child.close()
          const result = await fs.readFile(report, "utf8").then(
            (text) => JSON.parse(text),
            () => undefined,
          )
          if (result?.pid) {
            try {
              process.kill(result.pid)
            } catch (error) {
              if (error.code !== "ESRCH") throw error
            }
          }
        }
      }
      assert(cancelled > 0, "The fixture must actually cancel a pending write")
      console.log("cancelled-write passed")
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
    return
  }
  if (process.argv[2] === "worker") {
    for (let index = 0; index < 20; index++) {
      const worker = new Worker(__filename, { workerData: { node } })
      const pid = await new Promise((resolve, reject) => {
        worker.once("message", resolve)
        worker.once("error", reject)
      })
      try {
        await worker.terminate()
        assert.throws(() => process.kill(pid, 0))
      } finally {
        try {
          process.kill(pid)
        } catch (error) {
          if (error.code !== "ESRCH") throw error
        }
      }
    }
    console.log("worker passed")
    return
  }
  for (let index = 0; index < 100; index++) {
    const child = capture.start(launch("require('fs').writeSync(1,Buffer.alloc(1048576,120))"))
    const pending = [child.exited, child.readStdout(), child.readStderr()]
    child.close()
    await Promise.allSettled(pending)
    assert.throws(() => process.kill(child.pid, 0))
  }
  console.log("close passed")
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
