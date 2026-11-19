// The SyntaxError it throws is catchable, names the ESTree node type, and runs after earlier statements.
const r = []
for (const run of [
  () => { class A {} },
  () => { with ({}) {} },
  () => { debugger },
  function () { return new.target },
  () => (class {}),
  () => ({ m() { return super.m() } }).m(),
]) {
  try {
    r.push(run())
  } catch (e) {
    r.push([e.name, e instanceof SyntaxError, e.message.split(".")[0]])
  }
}
console.log("done")
return r
