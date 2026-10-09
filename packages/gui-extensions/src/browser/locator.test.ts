import { describe, expect, test } from "bun:test"
import { isExplicitLocator, parseLocator, type Step } from "./locator"

describe("parseLocator", () => {
  test.each<[string, readonly Step[]]>([
    ["#save", [{ kind: "css", selector: "#save" }]],
    ["form button.primary", [{ kind: "css", selector: "form button.primary" }]],
    ["css=div > span", [{ kind: "css", selector: "div > span" }]],
    ['input[name="q"]', [{ kind: "css", selector: 'input[name="q"]' }]],
    ["xpath=//main//a", [{ kind: "xpath", expression: "//main//a" }]],
    ["//main//a", [{ kind: "xpath", expression: "//main//a" }]],
    ["..", [{ kind: "xpath", expression: ".." }]],
    ["(//a)[2]", [{ kind: "xpath", expression: "(//a)[2]" }]],
    ["text=Save", [{ kind: "text", text: "Save", exact: false }]],
    ["text = Save draft ", [{ kind: "text", text: "Save draft", exact: false }]],
    ['text="Save"', [{ kind: "text", text: "Save", exact: true }]],
    ["text='Save'", [{ kind: "text", text: "Save", exact: true }]],
    ['"Save"', [{ kind: "text", text: "Save", exact: true }]],
    ["text=Don't save", [{ kind: "text", text: "Don't save", exact: false }]],
    ["text=Price (USD", [{ kind: "text", text: "Price (USD", exact: false }]],
    ["label=Email", [{ kind: "label", text: "Email", exact: false }]],
    ['label="Email address"', [{ kind: "label", text: "Email address", exact: true }]],
    ["placeholder=Search", [{ kind: "placeholder", text: "Search", exact: false }]],
    ["testid=submit", [{ kind: "testid", id: "submit" }]],
    ['testid="submit button"', [{ kind: "testid", id: "submit button" }]],
    ["role=heading", [{ kind: "role", role: "heading", exact: false }]],
    ["role=BUTTON", [{ kind: "role", role: "button", exact: false }]],
    ['role=button[name="Send"]', [{ kind: "role", role: "button", name: "Send", exact: true }]],
    ["role=button[name='Send']", [{ kind: "role", role: "button", name: "Send", exact: true }]],
    ["role=button[name=Send]", [{ kind: "role", role: "button", name: "Send", exact: false }]],
    ['role=button[name="Send" i]', [{ kind: "role", role: "button", name: "Send", exact: false }]],
    ['role=button[ name = "Send now" ]', [{ kind: "role", role: "button", name: "Send now", exact: true }]],
    ["nth=0", [{ kind: "nth", index: 0 }]],
    ["nth=-1", [{ kind: "nth", index: -1 }]],
    ["@e12", [{ kind: "ref", ref: "e12" }]],
    ["e7", [{ kind: "ref", ref: "e7" }]],
  ])("%s", (input, steps) => {
    expect(parseLocator(input)).toEqual(steps)
  })

  test("unescapes backslashes inside quotes", () => {
    expect(parseLocator('text="Say \\"hi\\""')).toEqual([{ kind: "text", text: 'Say "hi"', exact: true }])
    expect(parseLocator("text='It\\'s'")).toEqual([{ kind: "text", text: "It's", exact: true }])
    expect(parseLocator('text="a\\\\b"')).toEqual([{ kind: "text", text: "a\\b", exact: true }])
    expect(parseLocator('role=button[name="Say \\"hi\\""]')).toEqual([
      { kind: "role", role: "button", name: 'Say "hi"', exact: true },
    ])
  })

  test("chains steps on >> outside quotes, brackets, and parentheses", () => {
    expect(parseLocator("@e3 >> text=Save >> nth=1")).toEqual([
      { kind: "ref", ref: "e3" },
      { kind: "text", text: "Save", exact: false },
      { kind: "nth", index: 1 },
    ])
    expect(parseLocator('#form>>role=button[name="a >> b"]>>nth=-1')).toEqual([
      { kind: "css", selector: "#form" },
      { kind: "role", role: "button", name: "a >> b", exact: true },
      { kind: "nth", index: -1 },
    ])
    expect(parseLocator('text="x >> y" >> css=[data-x=">>"]')).toEqual([
      { kind: "text", text: "x >> y", exact: true },
      { kind: "css", selector: '[data-x=">>"]' },
    ])
    expect(parseLocator("xpath=//a[contains(., 'a >> b')] >> nth=0")).toEqual([
      { kind: "xpath", expression: "//a[contains(., 'a >> b')]" },
      { kind: "nth", index: 0 },
    ])
    expect(parseLocator("text=Don't >> label=Name")).toEqual([
      { kind: "text", text: "Don't", exact: false },
      { kind: "label", text: "Name", exact: false },
    ])
  })

  test.each([
    ["", /empty/],
    ["   ", /empty/],
    ["#a >> ", /empty step/],
    [">> #a", /empty step/],
    ["#a >>  >> #b", /empty step/],
    ['text="Save', /Unterminated " quote/],
    ["'Save", /Unterminated ' quote/],
    ['role=button[name="Send]', /Unterminated " quote/],
    ['text="Save" now', /after the closing quote/],
    ["text=", /text= needs a value/],
    ['text=""', /text= needs a value/],
    ["css=", /css= needs a selector/],
    ["xpath=", /xpath= needs an expression/],
    ["nth=first", /nth= takes an integer/],
    ["nth=1.5", /nth= takes an integer/],
    ["nth=", /nth= takes an integer/],
    ["#list >> @e12", /must be the first step/],
    ["#list >> e4", /must be the first step/],
    ["role=button[pressed]", /does not support the \[pressed\] attribute.*Supported: name/],
    ["role=button[name=Send][level=2]", /does not support the \[level\] attribute/],
    ["role=button[name]", /\[name\] needs a value/],
    ["role=button[name=]", /\[name\] needs a value/],
    ["role=button[name=Send", /Missing "\]"/],
    ["role=button name", /Unexpected/],
    ["role=", /role= needs an ARIA role/],
    ["id=save", /Unknown locator engine "id="/],
  ])("rejects %p", (input, message) => {
    expect(() => parseLocator(input)).toThrow(message)
  })

  test("errors teach the grammar", () => {
    expect(() => parseLocator("")).toThrow(/text=Save.*role=button\[name=.*nth=0/)
  })
})

describe("isExplicitLocator", () => {
  test.each([
    ["css=#a", true],
    ["text=Save", true],
    ["TEXT=Save", true],
    ['role=button[name="Send"]', true],
    ["label=Email", true],
    ["placeholder=Search", true],
    ["testid=x", true],
    ["xpath=//a", true],
    ["nth=0", true],
    ["@e12", true],
    ["e12", true],
    ["@e12 >> text=Save", true],
    ['"Save"', true],
    ["//main", true],
    ["#a >> #b", true],
    ["Save draft", false],
    ["#save", false],
    ["button.primary", false],
    ["e12 apples", false],
  ])("%s → %p", (input, explicit) => {
    expect(isExplicitLocator(input)).toBe(explicit)
  })
})
