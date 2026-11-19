function build(level) {
  if (level <= 0) return { a: 1, b: "two", c: [1, 2, 3], d: null }
  const branch = level - 1
  return { left: build(branch), right: build(branch), list: [level, `${level}`] }
}
let bytes = 0
let rounds = 20
while (rounds-- > 0) {
  const text = JSON.stringify(build(9))
  bytes += JSON.stringify(JSON.parse(text)).length
}
return bytes
