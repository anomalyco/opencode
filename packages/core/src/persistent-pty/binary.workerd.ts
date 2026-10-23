export const available = false

export async function resolveBinary(_bin: string): Promise<string> {
  throw new Error("Persistent PTYs are unavailable in this runtime")
}
