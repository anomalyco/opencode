// An unknown tool's rejection suggests the closest tool, for every shape of path a program can call.
const out = []
for (const call of [() => tools.ech(), () => tools.t(), () => tools.gi.status(), () => tools.git.stat(), () => tools.git(), () => tools.nope.deeper.call(), () => tools.e()]) {
  try {
    await call()
    out.push("ok")
  } catch (e) {
    out.push([e.name, e.message])
  }
}
return out
