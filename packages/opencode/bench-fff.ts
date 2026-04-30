import { Fff } from "./src/file/fff"
import { Instance } from "./src/project/instance"

const dir = process.cwd()

await Instance.provide({
  directory: dir,
  fn: async () => {
    const t0 = performance.now()
    const picker = await Fff.picker(dir)
    console.log(`picker create: ${(performance.now() - t0).toFixed(1)}ms`)

    // wait for scan to complete so results are populated
    const tw = performance.now()
    picker.waitForScan(10000)
    console.log(`wait for scan: ${(performance.now() - tw).toFixed(1)}ms`)

    const t1 = performance.now()
    const files = await Fff.files({ cwd: dir, query: "fff" })
    console.log(`file search "fff": ${(performance.now() - t1).toFixed(1)}ms (${files.items.length} results)`)

    const t2 = performance.now()
    const files2 = await Fff.files({ cwd: dir, query: "package.json" })
    console.log(`file search "package.json": ${(performance.now() - t2).toFixed(1)}ms (${files2.items.length} results)`)

    const t3 = performance.now()
    const grep = await Fff.grep({ cwd: dir, query: "FileFinder", mode: "plain" })
    console.log(`grep "FileFinder": ${(performance.now() - t3).toFixed(1)}ms (${grep.items.length} matches)`)

    const t4 = performance.now()
    const grep2 = await Fff.grep({ cwd: dir, query: "import", mode: "plain" })
    console.log(`grep "import": ${(performance.now() - t4).toFixed(1)}ms (${grep2.items.length} matches)`)

    const t5 = performance.now()
    const search = await Fff.search({ cwd: dir, pattern: "FileFinder" })
    console.log(`search "FileFinder": ${(performance.now() - t5).toFixed(1)}ms (${search.length} results)`)

    await Instance.dispose()
  },
})
