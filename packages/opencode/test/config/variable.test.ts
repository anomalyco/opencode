import { test, expect, describe } from "bun:test"
import { mkdtemp, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { ConfigVariable } from "@/config/variable"

describe("ConfigVariable.substitute file references in comments", () => {
  test("line comments are left untouched", async () => {
    const out = await ConfigVariable.substitute({
      type: "virtual",
      source: "test",
      dir: ".",
      text: `{
  // {file:does-not-exist.txt}
  "key": "value"
}`,
    })
    expect(out).toContain(`// {file:does-not-exist.txt}`)
  })

  test("block comments are left untouched", async () => {
    const out = await ConfigVariable.substitute({
      type: "virtual",
      source: "test",
      dir: ".",
      text: `{
  /* {file:does-not-exist.txt} */
  "key": "value"
}`,
    })
    expect(out).toContain(`/* {file:does-not-exist.txt} */`)
  })

  test("block comment spanning lines is left untouched", async () => {
    const out = await ConfigVariable.substitute({
      type: "virtual",
      source: "test",
      dir: ".",
      text: `{
  /*
   * {file:does-not-exist.txt}
   */
  "key": "value"
}`,
    })
    expect(out).toContain(`* {file:does-not-exist.txt}`)
  })

  test("// inside a string value is still substituted", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "opencode-subst-"))
    const refPath = path.join(dir, "ref.txt")
    await writeFile(refPath, "hello")

    const out = await ConfigVariable.substitute({
      type: "virtual",
      source: "test",
      dir,
      text: `{
  "prefix": "// not a comment",
  "value": "{file:ref.txt}"
}`,
    })
    expect(out).toContain(`"value": "hello"`)
    expect(out).toContain(`"prefix": "// not a comment"`)
  })

  test("file reference outside comments is substituted", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "opencode-subst-"))
    const refPath = path.join(dir, "ref.txt")
    await writeFile(refPath, "content")

    const out = await ConfigVariable.substitute({
      type: "virtual",
      source: "test",
      dir,
      text: `{
  "value": "{file:ref.txt}"
}`,
    })
    expect(out).toContain(`"value": "content"`)
  })
})
