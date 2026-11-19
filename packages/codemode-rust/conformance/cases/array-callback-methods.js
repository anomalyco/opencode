const xs = [1, 2, 3, 4, 5]
const seen = []
xs.forEach((x, i) => seen.push(x * i))
return [xs.map((x) => x * 2), xs.filter((x) => x % 2), xs.reduce((a, b) => a + b), xs.reduce((a, b) => a + b, 10), xs.find((x) => x > 2), xs.findIndex((x) => x > 2), xs.find((x) => x > 9), xs.some((x) => x > 4), xs.every((x) => x > 0), xs.flatMap((x) => [x, x]), seen]
