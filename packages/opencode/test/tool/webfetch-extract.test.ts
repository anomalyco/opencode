import { test, expect, describe } from "bun:test"
import { extractTextFromHTML } from "../../src/tool/webfetch"

describe("extractTextFromHTML", () => {
  test("keeps visible text and drops tags", () => {
    expect(extractTextFromHTML("<p>Hello <b>world</b></p>")).toBe("Hello world")
  })
  test("removes <script> content", () => {
    expect(extractTextFromHTML("<p>a</p><script>var x=1;</script><p>b</p>")).toBe("ab")
  })
  test("removes <style> content", () => {
    expect(extractTextFromHTML("<style>.x{color:red}</style><p>c</p>")).toBe("c")
  })
  test("removes <iframe> content", () => {
    expect(extractTextFromHTML("<p>vis</p><iframe>frame</iframe><p>vis2</p>")).toBe("visvis2")
  })
  test("a void element (<br>) does not desync skip tracking", () => {
    // Regression: previously any nested open tag inside a skipped region could
    // leave skipDepth stuck, swallowing the rest of the document. The <br> here
    // must not prevent "after" (outside the script) from being extracted.
    expect(extractTextFromHTML("<p>one<br>two</p><script>HIDDEN</script>after")).toBe("onetwoafter")
  })
  test("nested skip tags are fully removed", () => {
    expect(extractTextFromHTML("<div>keep<script>no<style>x</style>more</script>tail</div>")).toBe("keeptail")
  })
})
