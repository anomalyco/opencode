import { expect, test } from "bun:test"
import { uploads } from "./uploads"

test("cancelling an upload drops it even when its work never settles", async () => {
  const pending = uploads.track({ id: "stalled", filename: "image.png", mime: "image/png", size: 1024 }, () =>
    new Promise<string>(() => {}),
  )

  expect(uploads.items().map((item) => item.id)).toEqual(["stalled"])
  uploads.items()[0]?.cancel()

  expect(await pending).toBeUndefined()
  expect(uploads.items()).toEqual([])
})
