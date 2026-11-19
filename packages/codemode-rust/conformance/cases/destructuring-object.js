const { a, b: { c, d = 4 }, e: renamed = "def", ...rest } = { a: 1, b: { c: 3 }, x: 9, y: 10 }
return [a, c, d, renamed, rest]
