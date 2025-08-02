import { describe, expect, test } from "bun:test"
import { replace } from "../../src/tool/edit"

interface TestCase {
  content: string
  find: string
  replace: string
  all?: boolean
  fail?: boolean
}

const testCases: TestCase[] = [
  // SimpleReplacer cases
  {
    content: ["function hello() {", '  console.log("world");', "}"].join("\n"),
    find: 'console.log("world");',
    replace: 'console.log("universe");',
  },
  {
    content: ["if (condition) {", "  doSomething();", "  doSomethingElse();", "}"].join("\n"),
    find: ["  doSomething();", "  doSomethingElse();"].join("\n"),
    replace: ["  doNewThing();", "  doAnotherThing();"].join("\n"),
  },

  // LineTrimmedReplacer cases
  {
    content: ["function test() {", '    console.log("hello");', "}"].join("\n"),
    find: 'console.log("hello");',
    replace: 'console.log("goodbye");',
  },
  {
    content: ["const x = 5;   ", "const y = 10;"].join("\n"),
    find: "const x = 5;",
    replace: "const x = 15;",
  },
  {
    content: ["  if (true) {", "    return false;", "  }"].join("\n"),
    find: ["if (true) {", "return false;", "}"].join("\n"),
    replace: ["if (false) {", "return true;", "}"].join("\n"),
  },

  // BlockAnchorReplacer cases
  {
    content: [
      "function calculate(a, b) {",
      "  const temp = a + b;",
      "  const result = temp * 2;",
      "  return result;",
      "}",
    ].join("\n"),
    find: ["function calculate(a, b) {", "  // different middle content", "  return result;", "}"].join("\n"),
    replace: ["function calculate(a, b) {", "  return a * b * 2;", "}"].join("\n"),
  },
  {
    content: [
      "class MyClass {",
      "  constructor() {",
      "    this.value = 0;",
      "  }",
      "  ",
      "  getValue() {",
      "    return this.value;",
      "  }",
      "}",
    ].join("\n"),
    find: ["class MyClass {", "  // different implementation", "}"].join("\n"),
    replace: ["class MyClass {", "  constructor() {", "    this.value = 42;", "  }", "}"].join("\n"),
  },

  // WhitespaceNormalizedReplacer cases
  {
    content: ["function test() {", '\tconsole.log("hello");', "}"].join("\n"),
    find: '  console.log("hello");',
    replace: '  console.log("world");',
  },
  {
    content: "const   x    =     5;",
    find: "const x = 5;",
    replace: "const x = 10;",
  },
  {
    content: "if\t(  condition\t) {",
    find: "if ( condition ) {",
    replace: "if (newCondition) {",
  },

  // IndentationFlexibleReplacer cases
  {
    content: ["    function nested() {", '      console.log("deeply nested");', "      return true;", "    }"].join(
      "\n",
    ),
    find: ["function nested() {", '  console.log("deeply nested");', "  return true;", "}"].join("\n"),
    replace: ["function nested() {", '  console.log("updated");', "  return false;", "}"].join("\n"),
  },
  {
    content: ["  if (true) {", '    console.log("level 1");', '      console.log("level 2");', "  }"].join("\n"),
    find: ["if (true) {", 'console.log("level 1");', '  console.log("level 2");', "}"].join("\n"),
    replace: ["if (true) {", 'console.log("updated");', "}"].join("\n"),
  },

  // replaceAll option cases
  {
    content: ['console.log("test");', 'console.log("test");', 'console.log("test");'].join("\n"),
    find: 'console.log("test");',
    replace: 'console.log("updated");',
    all: true,
  },
  {
    content: ['console.log("test");', 'console.log("test");'].join("\n"),
    find: 'console.log("test");',
    replace: 'console.log("updated");',
    all: false,
  },

  // Error cases
  {
    content: 'console.log("hello");',
    find: "nonexistent string",
    replace: "updated",
    fail: true,
  },
  {
    content: ["test", "test", "different content", "test"].join("\n"),
    find: "test",
    replace: "updated",
    all: false,
    fail: true,
  },

  // Edge cases
  {
    content: "",
    find: "",
    replace: "new content",
  },
  {
    content: "const regex = /[.*+?^${}()|[\\\\]\\\\\\\\]/g;",
    find: "/[.*+?^${}()|[\\\\]\\\\\\\\]/g",
    replace: "/\\\\w+/g",
  },
  {
    content: 'const message = "Hello 世界! 🌍";',
    find: "Hello 世界! 🌍",
    replace: "Hello World! 🌎",
  },

  // EscapeNormalizedReplacer cases
  {
    content: 'console.log("Hello\nWorld");',
    find: 'console.log("Hello\\nWorld");',
    replace: 'console.log("Hello\nUniverse");',
  },
  {
    content: "const str = 'It's working';",
    find: "const str = 'It\\'s working';",
    replace: "const str = 'It's fixed';",
  },
  {
    content: "const template = `Hello ${name}`;",
    find: "const template = `Hello \\${name}`;",
    replace: "const template = `Hi ${name}`;",
  },
  {
    content: "const path = 'C:\\Users\\test';",
    find: "const path = 'C:\\\\Users\\\\test';",
    replace: "const path = 'C:\\Users\\admin';",
  },

  // MultiOccurrenceReplacer cases (with replaceAll)
  {
    content: ["debug('start');", "debug('middle');", "debug('end');"].join("\n"),
    find: "debug",
    replace: "log",
    all: true,
  },
  {
    content: "const x = 1; const y = 1; const z = 1;",
    find: "1",
    replace: "2",
    all: true,
  },

  // TrimmedBoundaryReplacer cases
  {
    content: ["  function test() {", "    return true;", "  }"].join("\n"),
    find: ["function test() {", "  return true;", "}"].join("\n"),
    replace: ["function test() {", "  return false;", "}"].join("\n"),
  },
  {
    content: "\n  const value = 42;  \n",
    find: "const value = 42;",
    replace: "const value = 24;",
  },
  {
    content: ["", "  if (condition) {", "    doSomething();", "  }", ""].join("\n"),
    find: ["if (condition) {", "  doSomething();", "}"].join("\n"),
    replace: ["if (condition) {", "  doNothing();", "}"].join("\n"),
  },

  // ContextAwareReplacer cases
  {
    content: [
      "function calculate(a, b) {",
      "  const temp = a + b;",
      "  const result = temp * 2;",
      "  return result;",
      "}",
    ].join("\n"),
    find: [
      "function calculate(a, b) {",
      "  // some different content here",
      "  // more different content",
      "  return result;",
      "}",
    ].join("\n"),
    replace: ["function calculate(a, b) {", "  return (a + b) * 2;", "}"].join("\n"),
  },
  {
    content: [
      "class TestClass {",
      "  constructor() {",
      "    this.value = 0;",
      "  }",
      "  ",
      "  method() {",
      "    return this.value;",
      "  }",
      "}",
    ].join("\n"),
    find: ["class TestClass {", "  // different implementation", "  // with multiple lines", "}"].join("\n"),
    replace: ["class TestClass {", "  getValue() { return 42; }", "}"].join("\n"),
  },

  // Combined edge cases for new replacers
  {
    content: '\tconsole.log("test");\t',
    find: 'console.log("test");',
    replace: 'console.log("updated");',
  },
  {
    content: ["  ", "function test() {", "  return 'value';", "}", "  "].join("\n"),
    find: ["function test() {", "return 'value';", "}"].join("\n"),
    replace: ["function test() {", "return 'new value';", "}"].join("\n"),
  },

  // Test for same oldString and newString (should fail)
  {
    content: 'console.log("test");',
    find: 'console.log("test");',
    replace: 'console.log("test");',
    fail: true,
  },

  // Additional tests for fixes made

  // WhitespaceNormalizedReplacer - test regex special characters that could cause errors
  {
    content: 'const pattern = "test[123]";',
    find: "test[123]",
    replace: "test[456]",
  },
  {
    content: 'const regex = "^start.*end$";',
    find: "^start.*end$",
    replace: "^begin.*finish$",
  },

  // EscapeNormalizedReplacer - test single backslash vs double backslash
  {
    content: 'const path = "C:\\Users";',
    find: 'const path = "C:\\Users";',
    replace: 'const path = "D:\\Users";',
  },
  {
    content: 'console.log("Line1\\nLine2");',
    find: 'console.log("Line1\\nLine2");',
    replace: 'console.log("First\\nSecond");',
  },

  // BlockAnchorReplacer - test edge case with exact newline boundaries
  {
    content: ["function test() {", "  return true;", "}"].join("\n"),
    find: ["function test() {", "  // middle", "}"].join("\n"),
    replace: ["function test() {", "  return false;", "}"].join("\n"),
  },

  // ContextAwareReplacer - test with trailing newline in find string
  {
    content: ["class Test {", "  method1() {", "    return 1;", "  }", "}"].join("\n"),
    find: [
      "class Test {",
      "  // different content",
      "}",
      "", // trailing empty line
    ].join("\n"),
    replace: ["class Test {", "  method2() { return 2; }", "}"].join("\n"),
  },

  // Test validation for empty strings with same oldString and newString
  {
    content: "",
    find: "",
    replace: "",
    fail: true,
  },

  // Test multiple occurrences with replaceAll=false (should fail)
  {
    content: ["const a = 1;", "const b = 1;", "const c = 1;"].join("\n"),
    find: "= 1",
    replace: "= 2",
    all: false,
    fail: true,
  },

  // Test whitespace normalization with multiple spaces and tabs mixed
  {
    content: "if\t \t( \tcondition\t )\t{",
    find: "if ( condition ) {",
    replace: "if (newCondition) {",
  },

  // Test escape sequences in template literals
  {
    content: "const msg = `Hello\\tWorld`;",
    find: "const msg = `Hello\\tWorld`;",
    replace: "const msg = `Hi\\tWorld`;",
  },

  // Test case that reproduces the greedy matching bug - now should fail due to low similarity
  {
    content: [
      "func main() {",
      "  if condition {",
      "    doSomething()",
      "  }",
      "  processData()",
      "  if anotherCondition {",
      "    doOtherThing()",
      "  }",
      "  return mainLayout",
      "}",
      "",
      "func helper() {",
      "  }",
      "  return mainLayout", // This should NOT be matched due to low similarity
      "}",
    ].join("\n"),
    find: ["  }", "  return mainLayout"].join("\n"),
    replace: ["  }", "  // Add some code here", "  return mainLayout"].join("\n"),
    fail: true, // This should fail because the pattern has low similarity score
  },

  // Test case for the fix - more specific pattern should work
  {
    content: [
      "function renderLayout() {",
      "  const header = createHeader()",
      "  const body = createBody()",
      "  return mainLayout",
      "}",
    ].join("\n"),
    find: ["function renderLayout() {", "  // different content", "  return mainLayout", "}"].join("\n"),
    replace: [
      "function renderLayout() {",
      "  const header = createHeader()",
      "  const body = createBody()",
      "  // Add minimap overlay",
      "  return mainLayout",
      "}",
    ].join("\n"),
  },

  // Test that large blocks without arbitrary size limits can work
  {
    content: Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n"),
    find: Array.from({ length: 50 }, (_, i) => `line ${i + 25}`).join("\n"),
    replace: Array.from({ length: 50 }, (_, i) => `updated line ${i + 25}`).join("\n"),
  },

  // Test case for the fix - more specific pattern should work
  {
    content: [
      "function renderLayout() {",
      "  const header = createHeader()",
      "  const body = createBody()",
      "  return mainLayout",
      "}",
    ].join("\n"),
    find: ["function renderLayout() {", "  // different content", "  return mainLayout", "}"].join("\n"),
    replace: [
      "function renderLayout() {",
      "  const header = createHeader()",
      "  const body = createBody()",
      "  // Add minimap overlay",
      "  return mainLayout",
      "}",
    ].join("\n"),
  },

  // Test BlockAnchorReplacer with overly large blocks (should fail)
  {
    content:
      Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n") +
      "\nfunction test() {\n" +
      Array.from({ length: 60 }, (_, i) => `  content ${i}`).join("\n") +
      "\n  return result\n}",
    find: ["function test() {", "  // different content", "  return result", "}"].join("\n"),
    replace: ["function test() {", "  return 42", "}"].join("\n"),
  },
]

describe("EditTool Replacers", () => {
  test.each(testCases)("case %#", (testCase) => {
    if (testCase.fail) {
      expect(() => {
        replace(testCase.content, testCase.find, testCase.replace, testCase.all)
      }).toThrow()
    } else {
      const result = replace(testCase.content, testCase.find, testCase.replace, testCase.all)
      expect(result).toContain(testCase.replace)
    }
  })
})
