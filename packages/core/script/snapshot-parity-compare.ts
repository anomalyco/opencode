// Compare two snapshot-parity.ts outputs and print every diverging step per scenario.
const [left, right] = await Promise.all(process.argv.slice(2, 4).map((file) => Bun.file(file!).json()))
let divergent = 0
for (const name of new Set([...Object.keys(left), ...Object.keys(right)])) {
  const a: unknown[] = left[name] ?? []
  const b: unknown[] = right[name] ?? []
  const differences = Array.from({ length: Math.max(a.length, b.length) }, (_, index) => index).filter(
    (index) => JSON.stringify(a[index]) !== JSON.stringify(b[index]),
  )
  if (!differences.length) {
    console.log(`same      ${name}`)
    continue
  }
  divergent++
  console.log(`DIFFERENT ${name}`)
  for (const index of differences) {
    console.log(`  step ${index}`)
    console.log(`    base: ${JSON.stringify(a[index])}`)
    console.log(`    new:  ${JSON.stringify(b[index])}`)
  }
}
console.log(divergent ? `${divergent} divergent scenarios` : "all scenarios identical")
