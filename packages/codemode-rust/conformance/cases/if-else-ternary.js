const classify = (n) => { if (n < 0) return "neg"; else if (n === 0) return "zero"; else return n > 10 ? "big" : "small" }
return [-1, 0, 5, 50].map(classify)
