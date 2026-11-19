let a = 5
a += 2; a -= 1; a *= 3; a /= 2; a %= 5
let b = 2 ** 10
let i = 0
const post = i++, pre = ++i
const bits = [5 & 3, 5 | 3, 5 ^ 3, ~5, 1 << 4, -16 >> 2, -16 >>> 28]
return [a, b, post, pre, i, bits, -7 % 3, 7 / 2]
