Promise.reject(new Error("boom")).catch(() => "handled")
await Promise.resolve()
return "done"
