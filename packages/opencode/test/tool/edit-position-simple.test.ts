import { describe, expect, it } from "bun:test"
import { mapFormattingPositions } from "../../src/util/position-mapper"
import * as prettier from "prettier"

describe("mapFormattingPositions - prettier formatting", () => {
  it("adds spaces around operators", async () => {
    const result = await testFormatting(`const sum = |start|a+b|end| * 2`)
    expect(result).toMatchInlineSnapshot(`
      "const sum = |start|a + b|end| * 2;
      "
    `)
  })

  it("converts double quotes to single quotes", async () => {
    const result = await testFormatting(
      `const msg = |start|"hello world"|end|`,
      { singleQuote: true }
    )
    expect(result).toMatchInlineSnapshot(`
      "const msg = |start|'hello world';
      |end|"
    `)
  })

  it("adds parentheses to arrow function", async () => {
    const result = await testFormatting(
      `const fn = |start|x => x * 2|end|`,
      { arrowParens: "always" }
    )
    expect(result).toMatchInlineSnapshot(`
      "const fn = (|start|x) => x * 2;
      |end|"
    `)
  })

  it("formats nested ternary operators", async () => {
    const result = await testFormatting(`const val = |start|a?b:c?d:e|end|`)
    expect(result).toMatchInlineSnapshot(`
      "const val = |start|a ? b : c ? d : e;
      |end|"
    `)
  })

  it("formats method chaining to multiple lines", async () => {
    const result = await testFormatting(
      `const result = arr.|start|filter(x=>x>0).map(x=>x*2).reduce((a,b)=>a+b,0)|end|`
    )
    expect(result).toMatchInlineSnapshot(`
      "const result = arr
        .|start|filter((x) => x > 0)
        .map((x) => x * 2)
        .reduce((a, b) => a + b, 0);
      |end|"
    `)
  })

  it("formats inline JSX to multi-line", async () => {
    const result = await testFormatting(
      `return |start|<div><span>text</span></div>|end|`
    )
    expect(result).toMatchInlineSnapshot(`
      "return (
        |start|<div>
          <span>text</span>
        </div>
      );
      |end|"
    `)
  })

  it("adds spaces to object destructuring", async () => {
    const result = await testFormatting(`const |start|{a,b,c}|end| = obj`)
    expect(result).toMatchInlineSnapshot(`
      "const |start|{ a, b, c }|end| = obj;
      "
    `)
  })

  it("adds trailing comma to array", async () => {
    const result = await testFormatting(
      `const arr = [|start|1,2,3|end|]`,
      { trailingComma: "all" }
    )
    expect(result).toMatchInlineSnapshot(`
      "const arr = [|start|1, 2, 3|end|];
      "
    `)
  })

  it("formats compact import statement", async () => {
    const result = await testFormatting(
      `import |start|{useState,useEffect}|end| from "react"`
    )
    expect(result).toMatchInlineSnapshot(`
      "import |start|{ useState, useEffect }|end| from "react";
      "
    `)
  })

  it("preserves template literal", async () => {
    const result = await testFormatting(
      `const str = |start|\`hello \${name}\`|end|`
    )
    expect(result).toMatchInlineSnapshot(`
      "const str = |start|\`hello \${name}\`;
      |end|"
    `)
  })

  it("formats minified function to multi-line", async () => {
    const result = await testFormatting(
      `|start|function getData(){const res=await fetch(url);return res.json()}|end|`
    )
    expect(result).toMatchInlineSnapshot(`
      "|start|function getData() {
        const res = await fetch(url);
        return res.json();
      }
      |end|"
    `)
  })

  it("formats switch cases", async () => {
    const result = await testFormatting(
      `switch(type){|start|case'a':return 1;case'b':return 2|end|}`
    )
    expect(result).toMatchInlineSnapshot(`
      "switch (type) {
        |start|case "a":
          return 1;
        case "b":
          return 2;
      |end|}
      "
    `)
  })

  it("formats compact class", async () => {
    const result = await testFormatting(
      `|start|class Service{constructor(private db:DB){}getUser(id:string){return this.db.find(id)}}|end|`
    )
    expect(result).toMatchInlineSnapshot(`
      "|start|class Service {
        constructor(private db: DB) {}
        getUser(id: string) {
          return this.db.find(id);
        }
      }
      |end|"
    `)
  })

  it("wraps long function parameters", async () => {
    const result = await testFormatting(
      `function fn(|start|a:string,b:number,c:boolean,d:any,e:unknown|end|){}`,
      { printWidth: 40 }
    )
    expect(result).toMatchInlineSnapshot(`
      "function fn(
        |start|a: string,
        b: number,
        c: boolean,
        d: any,
        e: unknown,
      |end|) {}
      "
    `)
  })

  it("formats compact ternary", async () => {
    const result = await testFormatting(
      `const val = |start|condition?trueValue:falseValue|end|`
    )
    expect(result).toMatchInlineSnapshot(`
      "const val = |start|condition ? trueValue : falseValue;
      |end|"
    `)
  })

  it("adds line breaks to object methods", async () => {
    const result = await testFormatting(
      `const obj = {|start|method(){return 42}|end|}`
    )
    expect(result).toMatchInlineSnapshot(`
      "const obj = {
        |start|method() {
          return 42;
        },
      |end|};
      "
    `)
  })

  it("formats export with bracket spacing", async () => {
    const result = await testFormatting(
      `export |start|{foo,bar}|end| from './module'`
    )
    expect(result).toMatchInlineSnapshot(`
      "export |start|{ foo, bar }|end| from "./module";
      "
    `)
  })

  it("formats try-catch block", async () => {
    const result = await testFormatting(
      `|start|try{doSomething()}catch(e){console.error(e)}|end|`
    )
    expect(result).toMatchInlineSnapshot(`
      "|start|try {
        doSomething();
      } catch (e) {
        console.error(e);
      }
      |end|"
    `)
  })

  it("formats union type", async () => {
    const result = await testFormatting(
      `type Result = |start|{data:T}|{error:Error}|end|`
    )
    expect(result).toMatchInlineSnapshot(`
      "type Result = |start|{ data: T } | { error: Error };
      |end|"
    `)
  })

  it("adds semicolons", async () => {
    const result = await testFormatting(
      `|start|const x = 1|end|\nconst y = 2`,
      { semi: true }
    )
    expect(result).toMatchInlineSnapshot(`
      "|start|const x = 1;|end|
      const y = 2;
      "
    `)
  })

  it("removes semicolons", async () => {
    const result = await testFormatting(
      `|start|const x = 1;|end|\nconst y = 2;`,
      { semi: false }
    )
    expect(result).toMatchInlineSnapshot(`
      "|start|const x = 1|end|
      const y = 2
      "
    `)
  })

  it("formats with tabs", async () => {
    const result = await testFormatting(
      `function test() {\n|start|console.log("hello")|end|\n}`,
      { useTabs: true }
    )
    expect(result).toMatchInlineSnapshot(`
      "function test() {
      	|start|console.log("hello");|end|
      }
      "
    `)
  })

  it("adds trailing commas to objects", async () => {
    const result = await testFormatting(
      `const obj = {|start|a: 1, b: 2|end|}`,
      { trailingComma: "all" }
    )
    expect(result).toMatchInlineSnapshot(`
      "const obj = { |start|a: 1, b: 2 |end|};
      "
    `)
  })

  it("formats arrow function with different parens options", async () => {
    const result = await testFormatting(
      `const fn = |start|(x) => x * 2|end|`,
      { arrowParens: "avoid" }
    )
    expect(result).toMatchInlineSnapshot(`
      "const fn = |start|x => x * 2;
      |end|"
    `)
  })

  it("handles complex object formatting", async () => {
    const result = await testFormatting(
      `const config = {|start|host:"localhost",port:3000,ssl:true|end|}`,
      { printWidth: 40 }
    )
    expect(result).toMatchInlineSnapshot(`
      "const config = {
        |start|host: "localhost",
        port: 3000,
        ssl: true,
      |end|};
      "
    `)
  })

  it("formats JSX with fragments", async () => {
    const result = await testFormatting(
      `return |start|<><div>A</div><div>B</div></>|end|`
    )
    expect(result).toMatchInlineSnapshot(`
      "return (
        |start|<>
          <div>A</div>
          <div>B</div>
        </>
      );
      |end|"
    `)
  })

  it("handles spread in arrays", async () => {
    const result = await testFormatting(
      `const arr = [|start|...a,...b|end|]`
    )
    expect(result).toMatchInlineSnapshot(`
      "const arr = [|start|...a, ...b|end|];
      "
    `)
  })

  it("formats type annotations", async () => {
    const result = await testFormatting(
      `type User = |start|{name:string;age:number}|end|`
    )
    expect(result).toMatchInlineSnapshot(`
      "type User = |start|{ name: string; age: number };
      |end|"
    `)
  })

  it("handles async/await formatting", async () => {
    const result = await testFormatting(
      `|start|async()=>{await fetch(url)}|end|`
    )
    expect(result).toMatchInlineSnapshot(`
      "|start|async () => {
        await fetch(url);
      };
      |end|"
    `)
  })

  it("formats array with trailing comma", async () => {
    const result = await testFormatting(
      `function test() {\nconst items = [|start|"a","b","c"|end|]\n}`,
      { trailingComma: "all" }
    )
    expect(result).toMatchInlineSnapshot(`
      "function test() {
        const items = [|start|"a", "b", "c"|end|];
      }
      "
    `)
  })

  it("formats object spread", async () => {
    const result = await testFormatting(
      `const merged = {...defaults,|start|...userConfig,...overrides|end|}`
    )
    expect(result).toMatchInlineSnapshot(`
      "const merged = { ...defaults, |start|...userConfig, ...overrides |end|};
      "
    `)
  })

  it("formats conditional expression", async () => {
    const result = await testFormatting(
      `const result = |start|isValid ? processData(data) : handleError(error)|end|`
    )
    expect(result).toMatchInlineSnapshot(`
      "const result = |start|isValid ? processData(data) : handleError(error);
      |end|"
    `)
  })

  it("formats destructuring with defaults", async () => {
    const result = await testFormatting(
      `const {|start|name="John",age=30,active=true|end|} = user`
    )
    expect(result).toMatchInlineSnapshot(`
      "const { |start|name = "John", age = 30, active = true |end|} = user;
      "
    `)
  })
})

async function testFormatting(
  input: string,
  options: prettier.Options = {}
): Promise<string> {
  const startMarker = "|start|"
  const endMarker = "|end|"
  
  // Find marker positions
  const startIdx = input.indexOf(startMarker)
  const endIdx = input.indexOf(endMarker)
  
  if (startIdx === -1 || endIdx === -1) {
    throw new Error("Missing |start| or |end| markers")
  }
  
  // Extract the original position (accounting for the start marker length)
  const originalStart = startIdx
  const originalEnd = endIdx - startMarker.length
  
  // Remove markers to get clean content
  const originalContent = input.replace(startMarker, "").replace(endMarker, "")
  
  // Format the entire content with Prettier
  const formattedContent = await prettier.format(originalContent, {
    parser: "typescript",
    printWidth: 80,
    tabWidth: 2,
    useTabs: false,
    semi: true,
    ...options
  })
  
  // Use mapFormattingPositions to map the positions
  const result = mapFormattingPositions(
    originalContent,
    formattedContent,
    originalStart,
    originalEnd
  )
  
  // Insert markers at the mapped positions
  return insertMarkers(result.newContent, result.start, result.end)
}

function insertMarkers(text: string, start: number, end: number): string {
  return text.slice(0, start) + "|start|" + text.slice(start, end) + "|end|" + text.slice(end)
}