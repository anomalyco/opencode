// At the top level `await` is a plain name, except where an expression starts with it; escaped, it is a label.
var await
let total = 0
aw\u0061it: for (const n of [1, 2, 3]) {
  if (n === 3) break aw\u0061it
  total += n
}
function inner() {
  var await = 2
  return await
}
const read = () => await
const o = { await: 4 }
return [read(), total, inner(), o.await]
