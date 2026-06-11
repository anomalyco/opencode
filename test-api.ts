import { createOpencodeClient } from "./packages/sdk/js/src/v2/index"

async function main() {
  const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:4096" })
  try {
    const res = await client.config.update({ config: { followup: "wrap" } })
    console.log("Update to wrap:", res.data, res.error)
    
    const res2 = await client.config.update({ config: { followup: "queue" } })
    console.log("Update to queue:", res2.data, res2.error)
  } catch(e) {
    console.log("Exception:", e)
  }
}
main()
