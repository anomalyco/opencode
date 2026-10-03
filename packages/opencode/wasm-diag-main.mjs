const worker = new Worker(new URL("./wasm-diag-worker.mjs", import.meta.url), {
  env: Object.fromEntries(Object.entries(process.env).filter((entry) => entry[1] !== undefined)),
})

worker.onmessage = (e) => {
  console.log("[worker]", JSON.stringify(e.data))
  if (e.data.step === "worker-all-ok" || e.data.step === "failed") {
    worker.terminate()
    process.exit(e.data.step === "failed" ? 1 : 0)
  }
}

worker.postMessage("run")
