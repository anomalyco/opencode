for (let i = 0; i < 100; i += 1) Promise.reject(new Error("x".repeat(1_000)))
return "done"
