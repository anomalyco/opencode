// Gateway-sized catalog shared by the settings keeper and its benchmark.
export function modelCatalog() {
  const all = ["a", "b", "c"].map((gateway) => ({
    id: `gateway-${gateway}`,
    name: `Gateway ${gateway.toUpperCase()}`,
    models: Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => {
        const id = `model-${String(index).padStart(3, "0")}`

        return [
          id,
          { id, name: `${gateway.toUpperCase()} Model ${String(index).padStart(3, "0")}`, limit: { context: 200_000 } },
        ]
      }),
    ),
  }))

  return { all, connected: all.map((item) => item.id), default: {} }
}
