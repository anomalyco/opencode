import { expect, expectTypeOf, test } from "vitest";
import { type ZodCustomStringFormat, hash } from "zod"; // adjust path as needed

test("hash() API — types and runtime across all alg/enc combinations", async () => {
  const { createHash } = await import("node:crypto");

  type Alg = "md5" | "sha1" | "sha256" | "sha384" | "sha512";
  // type Enc = "hex" | "base64" | "base64url";

  const toB64Url = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

  const makeDigests = (alg: Alg, input: string) => {
    const buf = createHash(alg).update(input).digest();
    const hex = buf.toString("hex");
    const base64 = buf.toString("base64");
    const base64url = toB64Url(base64);
    return { hex, base64, base64url };
  };

  const algs: ReadonlyArray<Alg> = ["md5", "sha1", "sha256", "sha384", "sha512"];
  const input = "zodasklfjaasdf";

  // --- Type-level checks (ensure the literal format string is encoded in the return type)
  expectTypeOf(hash("md5")).toEqualTypeOf<ZodCustomStringFormat<"md5_hex">>();
  expectTypeOf(hash("sha1")).toEqualTypeOf<ZodCustomStringFormat<"sha1_hex">>();
  expectTypeOf(hash("sha256", { enc: "base64" as const })).toEqualTypeOf<ZodCustomStringFormat<"sha256_base64">>();
  expectTypeOf(hash("sha384", { enc: "base64url" as const })).toEqualTypeOf<
    ZodCustomStringFormat<"sha384_base64url">
  >();

  // Test generic format types are correctly inferred and Enc defaults to "hex"
  expectTypeOf(hash("sha256")).toEqualTypeOf<ZodCustomStringFormat<"sha256_hex">>();

  // --- Runtime matrix (success + a few sharp-edged failures per combo)
  for (const alg of algs) {
    const { hex, base64, base64url } = makeDigests(alg, input);

    // Success cases
    expect(hash(alg).parse(hex)).toBe(hex); // default enc=hex
    expect(hash(alg, { enc: "hex" }).parse(hex)).toBe(hex);
    expect(hash(alg, { enc: "base64" }).parse(base64)).toBe(base64);
    expect(hash(alg, { enc: "base64url" }).parse(base64url)).toBe(base64url);

    // Failure cases (wrong encoding to schema)
    expect(() => hash(alg, { enc: "hex" }).parse(base64)).toThrow();
    expect(() => hash(alg, { enc: "base64" }).parse(hex)).toThrow();
    expect(() => hash(alg, { enc: "base64url" }).parse(base64)).toThrow();

    // Encoding-specific failures
    // hex: uppercase allowed, wrong length should fail
    hash(alg, { enc: "hex" }).parse(hex.toUpperCase());
    expect(() => hash(alg, { enc: "hex" }).parse(hex.slice(0, -1))).toThrow();

    // base64: missing required padding should fail (only for algorithms that require padding)
    if (base64.includes("=")) {
      const base64NoPad = base64.replace(/=+$/g, "");
      expect(() => hash(alg, { enc: "base64" }).parse(base64NoPad)).toThrow();
    }

    // base64url: adding padding or using invalid characters should fail
    expect(() => hash(alg, { enc: "base64url" }).parse(base64url + "=")).toThrow();
    expect(() => hash(alg, { enc: "base64url" }).parse(base64url + "!")).toThrow();

    // Param object present but enc omitted should still default to hex at runtime
    const schemaWithEmptyParams = hash(alg, {} as any);
    expect(schemaWithEmptyParams.parse(hex)).toBe(hex);
  }
});
