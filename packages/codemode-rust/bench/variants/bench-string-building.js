const BASE = "a".charCodeAt(0)
let text = ""
let idx = 0
while (idx < 5e4) {
  text = text + String.fromCharCode(BASE + (idx % 26))
  idx++
}
const pieces = []
for (let n = 0; n < 2e4; n += 1) pieces.push("item-" + n)
return text.length + pieces.join(",").length
