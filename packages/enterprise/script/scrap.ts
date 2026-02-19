import { Storage } from "../src/core/storage"

// read share id from args
const args = process.argv.slice(2)
if (args.length !== 1) {
  console.error("Usage: bun script/scrap.ts <shareID>")
  process.exit(1)
}
const shareID = args[0]

await Storage.remove(["share", shareID])
const list = await Storage.list({ prefix: ["share_data", shareID] })
for (const item of list) {
  await Storage.remove(item)
}
