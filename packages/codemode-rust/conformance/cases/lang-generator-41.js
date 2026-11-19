const completed = []
Promise.resolve().then(() => completed.push("reaction"))
for await (const item of []) {}
completed.push("after")

const closed = []
for await (const item of [1]) {
  Promise.resolve().then(() => closed.push("reaction"))
  break
}
closed.push("after")
return [completed, closed]
