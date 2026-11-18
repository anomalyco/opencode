// The namespace itself isn't callable, and its paths take only string names when deleted, as when read.
const out = []
for (const f of [() => tools(), () => delete tools[0], () => delete tools[Symbol.iterator], () => delete tools.git, () => delete tools["x"]]) {
  try {
    out.push(f())
  } catch (e) {
    out.push([e.name, e.message])
  }
}
return out
