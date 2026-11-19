const calls = []
let n = 0
while (n < 1e3) {
  calls.push(tools.echo({ id: n }))
  n++
}
const answers = await Promise.all(calls)
return answers.length
