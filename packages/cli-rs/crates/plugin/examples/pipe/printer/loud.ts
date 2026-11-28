// A module of the printer's own, which prints as it loads and when called.
console.log("loud.ts loads")
process.stdout.write("loud.ts writes as it loads\n")

export function shout(when: string) {
  console.log(`loud.ts shouts in ${when}`)
  process.stdout.write(`loud.ts writes in ${when}\n`)
}
