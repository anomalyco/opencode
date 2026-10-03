import { describe, expect, test } from "bun:test"

process.env.SST_RESOURCE_StatsPublicModelAliases = JSON.stringify({ value: '{"unknown/internal-code":"Public Model"}' })

const { isSourceModel, parsePublicModelAliases, publicModelName, sourceModelName } = await import("./public-model")

describe("public model aliases", () => {
  test("resolve display and database names without exposing the source as a public URL", () => {
    expect(publicModelName("unknown", "internal-code")).toBe("Public Model")
    expect(sourceModelName("unknown", "Public Model")).toBe("internal-code")
    expect(isSourceModel("unknown", "internal-code")).toBe(true)
    expect(isSourceModel("UNKNOWN", "INTERNAL-CODE")).toBe(true)
    expect(isSourceModel("unknown", "public-model")).toBe(false)
    expect(publicModelName("another-lab", "internal-code")).toBe("internal-code")
  })

  test("rejects malformed and colliding aliases", () => {
    expect(() => parsePublicModelAliases("[]")).toThrow("Invalid public model aliases")
    expect(() => parsePublicModelAliases('{"unknown/internal-code":"bad/name"}')).toThrow(
      "Invalid public model aliases",
    )
    expect(() => parsePublicModelAliases('{"unknown/one":"Two","unknown/two":"Two"}')).toThrow(
      "Public model alias collides with a source name",
    )
    expect(() => parsePublicModelAliases('{"unknown/one":"Three","unknown/two":"Four"}')).not.toThrow()
  })
})
