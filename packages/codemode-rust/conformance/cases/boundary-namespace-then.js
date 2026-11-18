// `then` names a path in a namespace like any other, and a namespace is never a thenable: awaiting or resolving one
// calls nothing.
const out = [typeof tools.then, typeof tools.git.then, typeof tools.git.then.then]
out.push(typeof (await tools.git))
out.push(typeof (await Promise.resolve(tools.git)))
out.push(typeof (await new Promise((resolve) => resolve(tools.git))))
out.push(typeof (await (async () => tools.git)()))
out.push(typeof (await Promise.all([tools.git]))[0])
return out
