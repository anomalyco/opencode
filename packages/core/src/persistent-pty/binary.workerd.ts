export async function resolveBinary(): Promise<string> {
  throw new Error("Persistent PTYs are unavailable in this runtime")
}
