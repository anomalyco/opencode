const { promise, resolve } = Promise.withResolvers()
tools.host.gated({ id: 1 }).then(resolve)
tools.host.open({ id: 1 })
return await promise
