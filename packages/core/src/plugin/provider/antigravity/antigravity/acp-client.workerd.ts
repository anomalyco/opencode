// workerd cannot spawn the Antigravity CLI, and the Antigravity plugin skips itself there.
throw new Error("The Antigravity CLI client is unavailable on the workerd runtime")
