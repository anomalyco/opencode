import { describe, expect, it } from "bun:test"
import { mapFormattingPositions } from "../../src/util/position-mapper"

describe("mapFormattingPositions - formatting transformations", () => {
  it("handles simple formatting - spaces around operators", () => {
    const result = testFormatting(
      "const a=1+2*3;const b=4;",
      "a=1+2*3",
      "a = 1 + 2 * 3"
    )
    expect(result).toMatchInlineSnapshot(`"const |start|a = 1 + 2 * 3|end|;const b=4;"`)
  })

  it("handles minified to formatted - object literal", () => {
    const result = testFormatting(
      `const config={host:"localhost",port:3000,ssl:true,options:{timeout:5000,retries:3}};`,
      `{host:"localhost",port:3000,ssl:true,options:{timeout:5000,retries:3}}`,
      `{
  host: "localhost",
  port: 3000,
  ssl: true,
  options: {
    timeout: 5000,
    retries: 3
  }
}`
    )
    expect(result).toMatchInlineSnapshot(`
      "const config=|start|{
        host: "localhost",
        port: 3000,
        ssl: true,
        options: {
          timeout: 5000,
          retries: 3
        }
      }|end|;"
    `)
  })

  it("handles arrow function transformation - adding braces and return", () => {
    const result = testFormatting(
      `const double = x => x * 2;
const triple = x => x * 3;`,
      "x => x * 2",
      `x => {
  return x * 2;
}`
    )
    expect(result).toMatchInlineSnapshot(`
      "const double = |start|x => {
        return x * 2;
      }|end|;
      const triple = x => x * 3;"
    `)
  })

  it("handles array method chaining - from single line to formatted", () => {
    const result = testFormatting(
      `const result = data.filter(x=>x>0).map(x=>x*2).reduce((a,b)=>a+b,0);`,
      `data.filter(x=>x>0).map(x=>x*2).reduce((a,b)=>a+b,0)`,
      `data
  .filter(x => x > 0)
  .map(x => x * 2)
  .reduce((a, b) => a + b, 0)`
    )
    expect(result).toMatchInlineSnapshot(`
      "const result = |start|data
        .filter(x => x > 0)
        .map(x => x * 2)
        .reduce((a, b) => a + b, 0)|end|;"
    `)
  })

  it("handles JSX formatting - from inline to multi-line", () => {
    const result = testFormatting(
      `function App() {
return <div className="app"><header><h1>Title</h1></header><main><p>Content</p></main></div>;
}`,
      `<div className="app"><header><h1>Title</h1></header><main><p>Content</p></main></div>`,
      `<div className="app">
    <header>
      <h1>Title</h1>
    </header>
    <main>
      <p>Content</p>
    </main>
  </div>`
    )
    expect(result).toMatchInlineSnapshot(`
      "function App() {
      return |start|<div className="app">
          <header>
            <h1>Title</h1>
          </header>
          <main>
            <p>Content</p>
          </main>
        </div>|end|;
      }"
    `)
  })

  it("handles function declaration formatting", () => {
    const result = testFormatting(
      `function calculate(a,b,c){const sum=a+b+c;const avg=sum/3;return{sum,avg};}
function display() {}`,
      `function calculate(a,b,c){const sum=a+b+c;const avg=sum/3;return{sum,avg};}`,
      `function calculate(a, b, c) {
  const sum = a + b + c;
  const avg = sum / 3;
  return { sum, avg };
}`
    )
    expect(result).toMatchInlineSnapshot(`
      "|start|function calculate(a, b, c) {
        const sum = a + b + c;
        const avg = sum / 3;
        return { sum, avg };
      }|end|
      function display() {}"
    `)
  })

  it("handles conditional (ternary) operator formatting", () => {
    const result = testFormatting(
      `const message=isValid?isAuthorized?"Welcome":"Not authorized":"Invalid";`,
      `isValid?isAuthorized?"Welcome":"Not authorized":"Invalid"`,
      `isValid
  ? isAuthorized
    ? "Welcome"
    : "Not authorized"
  : "Invalid"`
    )
    expect(result).toMatchInlineSnapshot(`
      "const message=|start|isValid
        ? isAuthorized
          ? "Welcome"
          : "Not authorized"
        : "Invalid"|end|;"
    `)
  })

  it("handles class formatting with decorators", () => {
    const result = testFormatting(
      `@injectable()class UserService{constructor(private db:Database){}async getUser(id:string){return this.db.users.find(id);}}export{UserService};`,
      `@injectable()class UserService{constructor(private db:Database){}async getUser(id:string){return this.db.users.find(id);}}`,
      `@injectable()
class UserService {
  constructor(private db: Database) {}

  async getUser(id: string) {
    return this.db.users.find(id);
  }
}`
    )
    expect(result).toMatchInlineSnapshot(`
      "|start|@injectable()
      class UserService {
        constructor(private db: Database) {}

        async getUser(id: string) {
          return this.db.users.find(id);
        }
      }|end|export{UserService};"
    `)
  })

  it("handles complex destructuring formatting", () => {
    const result = testFormatting(
      `const{name,age,address:{street,city,country="US"}}=user;`,
      `{name,age,address:{street,city,country="US"}}`,
      `{
  name,
  age,
  address: {
    street,
    city,
    country = "US"
  }
}`
    )
    expect(result).toMatchInlineSnapshot(`
      "const|start|{
        name,
        age,
        address: {
          street,
          city,
          country = "US"
        }
      }|end|=user;"
    `)
  })

  it("handles import statement formatting", () => {
    const result = testFormatting(
      `import{useState,useEffect,useCallback,useMemo}from"react";import{Button,Card}from"./components";`,
      `{useState,useEffect,useCallback,useMemo}`,
      `{
  useState,
  useEffect,
  useCallback,
  useMemo
}`
    )
    expect(result).toMatchInlineSnapshot(`
      "import|start|{
        useState,
        useEffect,
        useCallback,
        useMemo
      }|end|from"react";import{Button,Card}from"./components";"
    `)
  })

  it("handles async/await with try-catch formatting", () => {
    const result = testFormatting(
      `async function fetchData(){try{const res=await fetch(url);const data=await res.json();return data;}catch(e){console.error(e);throw e;}}`,
      `try{const res=await fetch(url);const data=await res.json();return data;}catch(e){console.error(e);throw e;}`,
      `try {
    const res = await fetch(url);
    const data = await res.json();
    return data;
  } catch (e) {
    console.error(e);
    throw e;
  }`
    )
    expect(result).toMatchInlineSnapshot(`
      "async function fetchData(){|start|try {
          const res = await fetch(url);
          const data = await res.json();
          return data;
        } catch (e) {
          console.error(e);
          throw e;
        }|end|}"
    `)
  })

  it("handles template literal formatting", () => {
    const result = testFormatting(
      "const sql=`SELECT * FROM users WHERE age>${minAge} AND city='${city}' ORDER BY name`;const other='test';",
      "`SELECT * FROM users WHERE age>${minAge} AND city='${city}' ORDER BY name`",
      `\`
  SELECT *
  FROM users
  WHERE age > \${minAge}
    AND city = '\${city}'
  ORDER BY name
\``
    )
    expect(result).toMatchInlineSnapshot(`
      "const sql=|start|\`
        SELECT *
        FROM users
        WHERE age > \${minAge}
          AND city = '\${city}'
        ORDER BY name
      \`|end|;const other='test';"
    `)
  })

  it("handles switch statement formatting", () => {
    const result = testFormatting(
      `function getColor(type){switch(type){case"error":return"red";case"warning":return"yellow";case"success":return"green";default:return"gray";}}`,
      `switch(type){case"error":return"red";case"warning":return"yellow";case"success":return"green";default:return"gray";}`,
      `switch (type) {
    case "error":
      return "red";
    case "warning":
      return "yellow";
    case "success":
      return "green";
    default:
      return "gray";
  }`
    )
    expect(result).toMatchInlineSnapshot(`
      "function getColor(type){|start|switch (type) {
          case "error":
            return "red";
          case "warning":
            return "yellow";
          case "success":
            return "green";
          default:
            return "gray";
        }|end|}"
    `)
  })

  it("handles replaceAll with formatting", () => {
    const result = testFormatting(
      `const a=1;const b=2;const c=3;`,
      "=",
      " = ",
      true
    )
    expect(result).toMatchInlineSnapshot(`"const a|start| = |end|1;const b = 2;const c = 3;"`)
  })

  it("handles empty file creation with formatted code", () => {
    const newString = `export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  subtract(a: number, b: number): number {
    return a - b;
  }
}`
    const result = testFormatting("", "", newString)
    expect(result).toMatchInlineSnapshot(`
      "|start|export class Calculator {
        add(a: number, b: number): number {
          return a + b;
        }

        subtract(a: number, b: number): number {
          return a - b;
        }
      }|end|"
    `)
  })

  it("handles multiple formatting changes in one replacement", () => {
    const result = testFormatting(
      `if(x>5&&y<10){console.log("valid");return true;}else{return false;}`,
      `if(x>5&&y<10){console.log("valid");return true;}else{return false;}`,
      `if (x > 5 && y < 10) {
  console.log("valid");
  return true;
} else {
  return false;
}`
    )
    expect(result).toMatchInlineSnapshot(`
      "|start|if (x > 5 && y < 10) {
        console.log("valid");
        return true;
      } else {
        return false;
      }|end|"
    `)
  })

  it("handles React component with props formatting", () => {
    const result = testFormatting(
      `const Button=({label,onClick,disabled=false})=><button onClick={onClick}disabled={disabled}>{label}</button>;`,
      `({label,onClick,disabled=false})=><button onClick={onClick}disabled={disabled}>{label}</button>`,
      `({ label, onClick, disabled = false }) => (
  <button onClick={onClick} disabled={disabled}>
    {label}
  </button>
)`
    )
    expect(result).toMatchInlineSnapshot(`
      "const Button=|start|({ label, onClick, disabled = false }) => (
        <button onClick={onClick} disabled={disabled}>
          {label}
        </button>
      )|end|;"
    `)
  })

  it("handles loop formatting", () => {
    const result = testFormatting(
      `for(let i=0;i<items.length;i++){const item=items[i];process(item);}`,
      `for(let i=0;i<items.length;i++){const item=items[i];process(item);}`,
      `for (let i = 0; i < items.length; i++) {
  const item = items[i];
  process(item);
}`
    )
    expect(result).toMatchInlineSnapshot(`
      "|start|for (let i = 0; i < items.length; i++) {
        const item = items[i];
        process(item);
      }|end|"
    `)
  })

  it("verifies marker extraction works correctly", () => {
    const text = "before |start|middle content here|end| after"
    const extracted = extractBetweenMarkers(text)
    expect(extracted).toBe("middle content here")
  })
})

// Test helpers at end of file
function insertMarkers(text: string, start: number, end: number): string {
  const withEnd = text.slice(0, end) + "|end|" + text.slice(end)
  const withBoth = withEnd.slice(0, start) + "|start|" + withEnd.slice(start)
  return withBoth
}

function extractBetweenMarkers(text: string): string {
  const startMarker = "|start|"
  const endMarker = "|end|"
  
  const startIndex = text.indexOf(startMarker)
  const endIndex = text.indexOf(endMarker)
  
  if (startIndex === -1 || endIndex === -1) {
    throw new Error("Markers not found in text")
  }
  
  return text.slice(startIndex + startMarker.length, endIndex)
}

function testFormatting(content: string, oldString: string, newString: string, replaceAll = false) {
  const result = mapFormattingPositions(content, oldString, newString, replaceAll)
  const markedResult = insertMarkers(result.newContent, result.start, result.end)
  
  const extracted = extractBetweenMarkers(markedResult)
  expect(extracted).toBe(newString)
  
  return markedResult
}