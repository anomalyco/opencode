Promise.reject(new Error("boom")).then((value) => value)
await Promise.resolve()
return "done"
