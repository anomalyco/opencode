const single = []
for (let index = 0; index < 5; ++index) single.push(() => index)

const left = []
const right = []
for (let first = 0, second = 10; first < 5; ++first, ++second) {
  left.push(() => first)
  right.push(() => second)
}
return [
  single.map((read) => read()),
  left.map((read) => read()),
  right.map((read) => read()),
]
