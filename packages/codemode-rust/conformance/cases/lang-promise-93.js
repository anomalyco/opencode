new Promise((_, reject) => reject(new Error("dropped")))
await Promise.resolve()
await Promise.resolve()
return "done"
