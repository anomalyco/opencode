export {}

// OpenSSH launches the desktop executable for each authentication prompt.
// Dispatch before importing application logging, storage, or single-instance handling.
if (process.env.OPENCODE_SSH_ASKPASS_PORT) {
  const { app } = await import("electron")
  if (process.platform === "darwin") app.setActivationPolicy("prohibited")
  const { runAskpass } = await import("./ssh/worker")
  process.exit(await runAskpass())
}

await import("./desktop")
