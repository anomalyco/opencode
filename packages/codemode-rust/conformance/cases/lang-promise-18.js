Promise.reject(new Error("first"))
tools.host.fail({})
Promise.reject(new Error("third"))
return "done"
