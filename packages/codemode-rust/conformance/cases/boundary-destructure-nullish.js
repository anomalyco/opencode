// Destructuring null or undefined names the value without quotes, in every form.
const t = (f) => { try { return f() } catch (e) { return [e.name, e.message] } }
const out = []
for (const v of [null, undefined]) {
  out.push([
    t(() => { const { a } = v; return a }),
    t(() => { const { a = 1, ...r } = v; return a }),
    t(() => { const { a: { b } } = { a: v }; return b }),
    t(() => { let a; ({ a } = v); return a }),
    t(() => (({ a }) => a)(v)),
    t(() => (function ({ a }) { return a })(v)),
    t(() => { for (const { a } of [v]) return a }),
    t(() => { const [{ a }] = [v]; return a }),
    t(() => { const [a] = v; return a }),
    t(() => { const [[a]] = [v]; return a }),
  ])
}
return out
