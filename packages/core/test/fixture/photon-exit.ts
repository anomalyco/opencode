import photon from "@silvia-odwyer/photon-node"
import { Effect } from "effect"
import { Photon } from "@opencode/core/image/photon"

// Runs one photon worker job, then lets the process exit on its own. The test
// times how long that takes, so nothing here may hold the event loop open.
if (process.argv[2] === "abandon-spawn") {
  await Effect.runPromise(
    Photon.spawnWorker(new URL("./photon-hang-worker.ts", import.meta.url)).pipe(
      Effect.timeout("200 millis"),
      Effect.ignore,
    ),
  )
} else {
  const source = new photon.PhotonImage(new Uint8Array(400 * 400 * 4).fill(200), 400, 400)
  const content = {
    uri: "file:///fixture.png",
    content: Buffer.from(source.get_bytes()).toString("base64"),
    encoding: "base64" as const,
    mime: "image/png",
  }
  source.free()
  let spawned = 0
  const normalize = Photon.makeWith(Photon.spawnWorker().pipe(Effect.tap(() => Effect.sync(() => spawned++))))
  const limits = { autoResize: true, maxWidth: 100, maxHeight: 100, maxBase64Bytes: 5 * 1024 * 1024 }
  const result = await Effect.runPromise(normalize("fixture.png", content, limits))
  if (spawned !== 1 || result === content) process.exit(2)
}
console.log(Date.now())
