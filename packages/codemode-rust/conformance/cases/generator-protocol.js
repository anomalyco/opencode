function* g() { yield 1; yield 2; return 3 }
const it = g()
return [it.next(), it.next(), it.next(), it.next()]
