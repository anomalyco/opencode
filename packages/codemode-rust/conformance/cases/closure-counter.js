const counter = () => { let n = 0; return { inc: () => ++n, get: () => n } }
const a = counter(), b = counter()
a.inc(); a.inc(); b.inc()
return [a.get(), b.get()]
