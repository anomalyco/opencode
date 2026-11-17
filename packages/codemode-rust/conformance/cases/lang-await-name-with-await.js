// A program may name things `await` and still await at the top level: names inside functions, bindings and escaped
// labels are names; an expression starting with a plain `await` outside every function awaits.
var await = 1
let escaped = 0
aw\u0061it: for (;;) {
  escaped++
  break aw\u0061it
}
const awaited = await Promise.resolve(5)
function read() {
  return await
}
const arrow = () => await
function write() {
  await = 7
}
function await2() {
  return typeof await
}
async function inner() {
  return await 3
}
const before = [read(), arrow(), await2()]
write()
return [awaited, escaped, before, read(), await inner()]
