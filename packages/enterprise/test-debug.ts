import { Share } from "./src/core/share"
import { Storage } from "./src/core/storage"

async function test() {
  const shareInfo = await Share.create({ sessionID: "test-debug-" + Date.now() })

  const batch1: Share.Data[] = [
    { type: "part", data: { id: "part1", sessionID: "session1", messageID: "msg1", type: "text", text: "Hello" } },
  ]

  const batch2: Share.Data[] = [
    {
      type: "part",
      data: { id: "part1", sessionID: "session1", messageID: "msg1", type: "text", text: "Hello Updated" },
    },
  ]

  await Share.sync({
    share: { id: shareInfo.id, secret: shareInfo.secret },
    data: batch1,
  })

  await Share.sync({
    share: { id: shareInfo.id, secret: shareInfo.secret },
    data: batch2,
  })

  const events = await Storage.list({ prefix: ["share_event", shareInfo.id] })
  console.log("Events (raw):", events)
  console.log("Events (reversed):", events.toReversed())

  for (const event of events.toReversed()) {
    const data = await Storage.read(event)
    console.log("Event data (reversed order):", event, data)
  }

  await Share.remove({ id: shareInfo.id, secret: shareInfo.secret })
}

test()
