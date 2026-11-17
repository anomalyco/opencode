function fact(n) { return n <= 1 ? 1 : n * fact(n - 1) }
const even = (n) => (n === 0 ? true : odd(n - 1))
const odd = (n) => (n === 0 ? false : even(n - 1))
return [fact(10), even(10), odd(7)]
