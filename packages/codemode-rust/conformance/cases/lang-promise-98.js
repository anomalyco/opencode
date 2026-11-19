const never = async () => { await null; await new Promise(() => {}) }
return await Promise.all([never(), Promise.resolve(1)])
