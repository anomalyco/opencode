import "./plugin-runtime.promise"
import "./plugin-runtime.effect"

process.stdout.on("error", (error) => {
  if ("code" in error && error.code === "EPIPE") return
  throw error
})

await import("../index")
