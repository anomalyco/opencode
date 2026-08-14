import path from "node:path"

export async function verifyArtifact(binary: string) {
  const contents = Buffer.from(await Bun.file(binary).arrayBuffer())
  const target = path.basename(path.dirname(path.dirname(binary)))
  const platform = target.includes("darwin") ? "darwin" : target.includes("linux") ? "linux" : "win32"
  const markers = [
    "SimulationPng",
    "Drive.create",
    "@napi-rs/canvas",
    "commit-mono-latin-400-normal",
    "noto-sans-symbols-symbols-400-normal",
    "noto-sans-math-math-400-normal",
    "../simulation/src/",
    `skia.${platform}-`,
  ]
  const found = markers.filter((marker) => contents.includes(marker))
  if (found.length > 0) throw new Error(`Compiled CLI contains simulation artifacts: ${found.join(", ")}`)
}

if (import.meta.main) {
  const binary = process.argv[2]
  if (!binary) throw new Error("Usage: bun run script/verify-artifact.ts <binary>")
  await verifyArtifact(binary)
}
