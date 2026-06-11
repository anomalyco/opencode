import { createOpencodeClient } from "./packages/sdk/js/src/v2/index"

async function main() {
  const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:4096" })
  const res = await client.config.get()
  console.log(res.data)
  console.log(typeof res.data)
}
main()
