import { describe, expect, it } from "bun:test"
import { mapFormattingPositions } from "../../src/util/position-mapper"
import * as prettier from "prettier"

describe("mapFormattingPositions - prettier formatting", () => {
  it("adds spaces around operators", async () => {
    const result = await testFormatting(`const sum = ❮a+b❯ * 2`)
    expect(result).toMatchInlineSnapshot(`
      "const sum = ❮a + b❯ * 2;
      "
    `)
  })

  it("converts double quotes to single quotes", async () => {
    const result = await testFormatting(
      `const msg = ❮"hello world"❯`,
      { singleQuote: true }
    )
    expect(result).toMatchInlineSnapshot(`
      "const msg = ❮'hello world';
      ❯"
    `)
  })

  it("adds parentheses to arrow function", async () => {
    const result = await testFormatting(
      `const fn = ❮x => x * 2❯`,
      { arrowParens: "always" }
    )
    expect(result).toMatchInlineSnapshot(`
      "const fn = (❮x) => x * 2;
      ❯"
    `)
  })

  it("formats nested ternary operators", async () => {
    const result = await testFormatting(`const val = ❮a?b:c?d:e❯`)
    expect(result).toMatchInlineSnapshot(`
      "const val = ❮a ? b : c ? d : e;
      ❯"
    `)
  })

  it("formats method chaining to multiple lines", async () => {
    const result = await testFormatting(
      `const result = arr.❮filter(x=>x>0).map(x=>x*2).reduce((a,b)=>a+b,0)❯`
    )
    expect(result).toMatchInlineSnapshot(`
      "const result = arr
        .❮filter((x) => x > 0)
        .map((x) => x * 2)
        .reduce((a, b) => a + b, 0);
      ❯"
    `)
  })

  it("formats inline JSX to multi-line", async () => {
    const result = await testFormatting(
      `return ❮<div><span>text</span></div>❯`
    )
    expect(result).toMatchInlineSnapshot(`
      "return (
        ❮<div>
          <span>text</span>
        </div>
      );
      ❯"
    `)
  })

  it("adds spaces to object destructuring", async () => {
    const result = await testFormatting(`const ❮{a,b,c}❯ = obj`)
    expect(result).toMatchInlineSnapshot(`
      "const ❮{ a, b, c }❯ = obj;
      "
    `)
  })

  it("adds trailing comma to array", async () => {
    const result = await testFormatting(
      `const arr = [❮1,2,3❯]`,
      { trailingComma: "all" }
    )
    expect(result).toMatchInlineSnapshot(`
      "const arr = [❮1, 2, 3❯];
      "
    `)
  })

  it("formats compact import statement", async () => {
    const result = await testFormatting(
      `import ❮{useState,useEffect}❯ from "react"`
    )
    expect(result).toMatchInlineSnapshot(`
      "import ❮{ useState, useEffect }❯ from "react";
      "
    `)
  })

  it("preserves template literal", async () => {
    const result = await testFormatting(
      `const str = ❮\`hello \${name}\`❯`
    )
    expect(result).toMatchInlineSnapshot(`
      "const str = ❮\`hello \${name}\`;
      ❯"
    `)
  })

  it("formats minified function to multi-line", async () => {
    const result = await testFormatting(
      `❮function getData(){const res=await fetch(url);return res.json()}❯`
    )
    expect(result).toMatchInlineSnapshot(`
      "❮function getData() {
        const res = await fetch(url);
        return res.json();
      }
      ❯"
    `)
  })

  it("formats switch cases", async () => {
    const result = await testFormatting(
      `switch(type){❮case'a':return 1;case'b':return 2❯}`
    )
    expect(result).toMatchInlineSnapshot(`
      "switch (type) {
        ❮case "a":
          return 1;
        case "b":
          return 2;
      ❯}
      "
    `)
  })

  it("formats compact class", async () => {
    const result = await testFormatting(
      `❮class Service{constructor(private db:DB){}getUser(id:string){return this.db.find(id)}}❯`
    )
    expect(result).toMatchInlineSnapshot(`
      "❮class Service {
        constructor(private db: DB) {}
        getUser(id: string) {
          return this.db.find(id);
        }
      }
      ❯"
    `)
  })

  it("wraps long function parameters", async () => {
    const result = await testFormatting(
      `function fn(❮a:string,b:number,c:boolean,d:any,e:unknown❯){}`,
      { printWidth: 40 }
    )
    expect(result).toMatchInlineSnapshot(`
      "function fn(
        ❮a: string,
        b: number,
        c: boolean,
        d: any,
        e: unknown,
      ❯) {}
      "
    `)
  })

  it("formats compact ternary", async () => {
    const result = await testFormatting(
      `const val = ❮condition?trueValue:falseValue❯`
    )
    expect(result).toMatchInlineSnapshot(`
      "const val = ❮condition ? trueValue : falseValue;
      ❯"
    `)
  })

  it("adds line breaks to object methods", async () => {
    const result = await testFormatting(
      `const obj = {❮method(){return 42}❯}`
    )
    expect(result).toMatchInlineSnapshot(`
      "const obj = {
        ❮method() {
          return 42;
        },
      ❯};
      "
    `)
  })

  it("formats export with bracket spacing", async () => {
    const result = await testFormatting(
      `export ❮{foo,bar}❯ from './module'`
    )
    expect(result).toMatchInlineSnapshot(`
      "export ❮{ foo, bar }❯ from "./module";
      "
    `)
  })

  it("formats try-catch block", async () => {
    const result = await testFormatting(
      `❮try{doSomething()}catch(e){console.error(e)}❯`
    )
    expect(result).toMatchInlineSnapshot(`
      "❮try {
        doSomething();
      } catch (e) {
        console.error(e);
      }
      ❯"
    `)
  })

  it("formats union type", async () => {
    const result = await testFormatting(
      `type Result = ❮{data:T}|{error:Error}❯`
    )
    expect(result).toMatchInlineSnapshot(`
      "type Result = ❮{ data: T } | { error: Error };
      ❯"
    `)
  })

  it("adds semicolons", async () => {
    const result = await testFormatting(
      `❮const x = 1❯\nconst y = 2`,
      { semi: true }
    )
    expect(result).toMatchInlineSnapshot(`
      "❮const x = 1;❯
      const y = 2;
      "
    `)
  })

  it("removes semicolons", async () => {
    const result = await testFormatting(
      `❮const x = 1;❯\nconst y = 2;`,
      { semi: false }
    )
    expect(result).toMatchInlineSnapshot(`
      "❮const x = 1❯
      const y = 2
      "
    `)
  })

  it("formats with tabs", async () => {
    const result = await testFormatting(
      `function test() {\n❮console.log("hello")❯\n}`,
      { useTabs: true }
    )
    expect(result).toMatchInlineSnapshot(`
      "function test() {
      	❮console.log("hello");❯
      }
      "
    `)
  })

  it("adds trailing commas to objects", async () => {
    const result = await testFormatting(
      `const obj = {❮a: 1, b: 2❯}`,
      { trailingComma: "all" }
    )
    expect(result).toMatchInlineSnapshot(`
      "const obj = { ❮a: 1, b: 2 ❯};
      "
    `)
  })

  it("formats arrow function with different parens options", async () => {
    const result = await testFormatting(
      `const fn = ❮(x) => x * 2❯`,
      { arrowParens: "avoid" }
    )
    expect(result).toMatchInlineSnapshot(`
      "const fn = ❮x => x * 2;
      ❯"
    `)
  })

  it("handles complex object formatting", async () => {
    const result = await testFormatting(
      `const config = {❮host:"localhost",port:3000,ssl:true❯}`,
      { printWidth: 40 }
    )
    expect(result).toMatchInlineSnapshot(`
      "const config = {
        ❮host: "localhost",
        port: 3000,
        ssl: true,
      ❯};
      "
    `)
  })

  it("formats JSX with fragments", async () => {
    const result = await testFormatting(
      `return ❮<><div>A</div><div>B</div></>❯`
    )
    expect(result).toMatchInlineSnapshot(`
      "return (
        ❮<>
          <div>A</div>
          <div>B</div>
        </>
      );
      ❯"
    `)
  })

  it("handles spread in arrays", async () => {
    const result = await testFormatting(
      `const arr = [❮...a,...b❯]`
    )
    expect(result).toMatchInlineSnapshot(`
      "const arr = [❮...a, ...b❯];
      "
    `)
  })

  it("formats type annotations", async () => {
    const result = await testFormatting(
      `type User = ❮{name:string;age:number}❯`
    )
    expect(result).toMatchInlineSnapshot(`
      "type User = ❮{ name: string; age: number };
      ❯"
    `)
  })

  it("handles async/await formatting", async () => {
    const result = await testFormatting(
      `❮async()=>{await fetch(url)}❯`
    )
    expect(result).toMatchInlineSnapshot(`
      "❮async () => {
        await fetch(url);
      };
      ❯"
    `)
  })

  it("formats array with trailing comma", async () => {
    const result = await testFormatting(
      `function test() {\nconst items = [❮"a","b","c"❯]\n}`,
      { trailingComma: "all" }
    )
    expect(result).toMatchInlineSnapshot(`
      "function test() {
        const items = [❮"a", "b", "c"❯];
      }
      "
    `)
  })

  it("formats object spread", async () => {
    const result = await testFormatting(
      `const merged = {...defaults,❮...userConfig,...overrides❯}`
    )
    expect(result).toMatchInlineSnapshot(`
      "const merged = { ...defaults, ❮...userConfig, ...overrides ❯};
      "
    `)
  })

  it("formats conditional expression", async () => {
    const result = await testFormatting(
      `const result = ❮isValid ? processData(data) : handleError(error)❯`
    )
    expect(result).toMatchInlineSnapshot(`
      "const result = ❮isValid ? processData(data) : handleError(error);
      ❯"
    `)
  })

  it("formats destructuring with defaults", async () => {
    const result = await testFormatting(
      `const {❮name="John",age=30,active=true❯} = user`
    )
    expect(result).toMatchInlineSnapshot(`
      "const { ❮name = "John", age = 30, active = true ❯} = user;
      "
    `)
  })
})

async function testFormatting(
  input: string,
  options: prettier.Options = {}
): Promise<string> {
  const startMarker = "❮"
  const endMarker = "❯"
  
  // Find marker positions
  const startIdx = input.indexOf(startMarker)
  const endIdx = input.indexOf(endMarker)
  
  if (startIdx === -1 || endIdx === -1) {
    throw new Error("Missing ❮ or ❯ markers")
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
  return text.slice(0, start) + "❮" + text.slice(start, end) + "❯" + text.slice(end)
}