const out = []
const ops = { push: (a) => a.push(9), pop: (a) => a.pop(), shift: (a) => a.shift(), unshift: (a) => a.unshift(0), splice: (a) => a.splice(0, 1), splice0: (a) => a.splice(0, 0), spliceAdd: (a) => a.splice(1, 0, 5), sort: (a) => a.sort(), reverse: (a) => a.reverse(), fill: (a) => a.fill(0), copyWithin: (a) => a.copyWithin(0, 1), pushNone: (a) => a.push(), popEmpty: (a) => a.pop() }
for (const [mk, make] of [["frozen", (x) => Object.freeze(x)], ["sealed", (x) => Object.seal(x)], ["nonext", (x) => Object.preventExtensions(x)]]) {
  for (const [name, op] of Object.entries(ops)) {
    for (const init of [[], [1], [2, 1]]) {
      const a = make([...init])
      try { op(a); out.push(`${mk} ${name} ${init.length} ok ${JSON.stringify(a)}`) } catch (e) { out.push(`${mk} ${name} ${init.length} ${e.message}`) }
    }
  }
}
return out
