import { describe, expect, it } from "bun:test"
import { mapFormattingPositions } from "../../src/util/position-mapper"
import * as prettier from "prettier"

describe("mapFormattingPositions - prettier formatting", () => {
  it("adds spaces around operators", async () => {
    const result = await testFormatting(`const sum = 《a+b》 * 2`)
    expect(result).toMatchInlineSnapshot(`
      "const sum = 《a + b》 * 2;
      "
    `)
  })

  it("converts double quotes to single quotes", async () => {
    const result = await testFormatting(`const msg = 《"hello world"》`, { singleQuote: true })
    expect(result).toMatchInlineSnapshot(`
      "const msg = 《'hello world';
      》"
    `)
  })

  it("adds parentheses to arrow function", async () => {
    const result = await testFormatting(`const fn = 《x => x * 2》`, { arrowParens: "always" })
    expect(result).toMatchInlineSnapshot(`
      "const fn = (《x) => x * 2;
      》"
    `)
  })

  it("formats nested ternary operators", async () => {
    const result = await testFormatting(`const val = 《a?b:c?d:e》`)
    expect(result).toMatchInlineSnapshot(`
      "const val = 《a ? b : c ? d : e;
      》"
    `)
  })

  it("formats method chaining to multiple lines", async () => {
    const result = await testFormatting(`const result = arr.《filter(x=>x>0).map(x=>x*2).reduce((a,b)=>a+b,0)》`)
    expect(result).toMatchInlineSnapshot(`
      "const result = arr
        .《filter((x) => x > 0)
        .map((x) => x * 2)
        .reduce((a, b) => a + b, 0);
      》"
    `)
  })

  it("formats inline JSX to multi-line", async () => {
    const result = await testFormatting(`return 《<div><span>text</span></div>》`)
    expect(result).toMatchInlineSnapshot(`
      "return (
        《<div>
          <span>text</span>
        </div>
      );
      》"
    `)
  })

  it("adds spaces to object destructuring", async () => {
    const result = await testFormatting(`const 《{a,b,c}》 = obj`)
    expect(result).toMatchInlineSnapshot(`
      "const 《{ a, b, c }》 = obj;
      "
    `)
  })

  it("adds trailing comma to array", async () => {
    const result = await testFormatting(`const arr = [《1,2,3》]`, { trailingComma: "all" })
    expect(result).toMatchInlineSnapshot(`
      "const arr = [《1, 2, 3》];
      "
    `)
  })

  it("formats compact import statement", async () => {
    const result = await testFormatting(`import 《{useState,useEffect}》 from "react"`)
    expect(result).toMatchInlineSnapshot(`
      "import 《{ useState, useEffect }》 from "react";
      "
    `)
  })

  it("preserves template literal", async () => {
    const result = await testFormatting(`const str = 《\`hello \${name}\`》`)
    expect(result).toMatchInlineSnapshot(`
      "const str = 《\`hello \${name}\`;
      》"
    `)
  })

  it("formats minified function to multi-line", async () => {
    const result = await testFormatting(`《function getData(){const res=await fetch(url);return res.json()}》`)
    expect(result).toMatchInlineSnapshot(`
      "《function getData() {
        const res = await fetch(url);
        return res.json();
      }
      》"
    `)
  })

  it("formats switch cases", async () => {
    const result = await testFormatting(`switch(type){《case'a':return 1;case'b':return 2》}`)
    expect(result).toMatchInlineSnapshot(`
      "switch (type) {
        《case "a":
          return 1;
        case "b":
          return 2;
      》}
      "
    `)
  })

  it("formats compact class", async () => {
    const result = await testFormatting(
      `《class Service{constructor(private db:DB){}getUser(id:string){return this.db.find(id)}}》`,
    )
    expect(result).toMatchInlineSnapshot(`
      "《class Service {
        constructor(private db: DB) {}
        getUser(id: string) {
          return this.db.find(id);
        }
      }
      》"
    `)
  })

  it("wraps long function parameters", async () => {
    const result = await testFormatting(`function fn(《a:string,b:number,c:boolean,d:any,e:unknown》){}`, {
      printWidth: 40,
    })
    expect(result).toMatchInlineSnapshot(`
      "function fn(
        《a: string,
        b: number,
        c: boolean,
        d: any,
        e: unknown,
      》) {}
      "
    `)
  })

  it("formats compact ternary", async () => {
    const result = await testFormatting(`const val = 《condition?trueValue:falseValue》`)
    expect(result).toMatchInlineSnapshot(`
      "const val = 《condition ? trueValue : falseValue;
      》"
    `)
  })

  it("adds line breaks to object methods", async () => {
    const result = await testFormatting(`const obj = {《method(){return 42}》}`)
    expect(result).toMatchInlineSnapshot(`
      "const obj = {
        《method() {
          return 42;
        },
      》};
      "
    `)
  })

  it("formats export with bracket spacing", async () => {
    const result = await testFormatting(`export 《{foo,bar}》 from './module'`)
    expect(result).toMatchInlineSnapshot(`
      "export 《{ foo, bar }》 from "./module";
      "
    `)
  })

  it("formats try-catch block", async () => {
    const result = await testFormatting(`console.log();\ntry{doSomething()}catch(e){console.error(e)}》`)
    expect(result).toMatchInlineSnapshot(`
      "《try {
        doSomething();
      } catch (e) {
        console.error(e);
      }
      》"
    `)
  })

  it("formats union type", async () => {
    const result = await testFormatting(`type Result = 《{data:T}|{error:Error}》`)
    expect(result).toMatchInlineSnapshot(`
      "type Result = 《{ data: T } | { error: Error };
      》"
    `)
  })

  it("adds semicolons", async () => {
    const result = await testFormatting(`《const x = 1》\nconst y = 2`, { semi: true })
    expect(result).toMatchInlineSnapshot(`
      "《const x = 1;》
      const y = 2;
      "
    `)
  })

  it("removes semicolons", async () => {
    const result = await testFormatting(`《const x = 1;》\nconst y = 2;`, { semi: false })
    expect(result).toMatchInlineSnapshot(`
      "《const x = 1》
      const y = 2
      "
    `)
  })

  it("formats with tabs", async () => {
    const result = await testFormatting(`function test() {\n《console.log("hello")》\n}`, { useTabs: true })
    expect(result).toMatchInlineSnapshot(`
      "function test() {
      	《console.log("hello");》
      }
      "
    `)
  })

  it("adds trailing commas to objects", async () => {
    const result = await testFormatting(`const obj = {《a: 1, b: 2》}`, { trailingComma: "all" })
    expect(result).toMatchInlineSnapshot(`
      "const obj = { 《a: 1, b: 2 》};
      "
    `)
  })

  it("formats arrow function with different parens options", async () => {
    const result = await testFormatting(`const fn = 《(x) => x * 2》`, { arrowParens: "avoid" })
    expect(result).toMatchInlineSnapshot(`
      "const fn = 《x => x * 2;
      》"
    `)
  })

  it("handles complex object formatting", async () => {
    const result = await testFormatting(`const config = {《host:"localhost",port:3000,ssl:true》}`, { printWidth: 40 })
    expect(result).toMatchInlineSnapshot(`
      "const config = {
        《host: "localhost",
        port: 3000,
        ssl: true,
      》};
      "
    `)
  })

  it("formats JSX with fragments", async () => {
    const result = await testFormatting(`return 《<><div>A</div><div>B</div></>》`)
    expect(result).toMatchInlineSnapshot(`
      "return (
        《<>
          <div>A</div>
          <div>B</div>
        </>
      );
      》"
    `)
  })

  it("handles spread in arrays", async () => {
    const result = await testFormatting(`const arr = [《...a,...b》]`)
    expect(result).toMatchInlineSnapshot(`
      "const arr = [《...a, ...b》];
      "
    `)
  })

  it("formats type annotations", async () => {
    const result = await testFormatting(`type User = 《{name:string;age:number}》`)
    expect(result).toMatchInlineSnapshot(`
      "type User = 《{ name: string; age: number };
      》"
    `)
  })

  it("handles async/await formatting", async () => {
    const result = await testFormatting(`《async()=>{await fetch(url)}》`)
    expect(result).toMatchInlineSnapshot(`
      "《async () => {
        await fetch(url);
      };
      》"
    `)
  })

  it("formats array with trailing comma", async () => {
    const result = await testFormatting(`function test() {\nconst items = [《"a","b","c"》]\n}`, {
      trailingComma: "all",
    })
    expect(result).toMatchInlineSnapshot(`
      "function test() {
        const items = [《"a", "b", "c"》];
      }
      "
    `)
  })

  it("formats object spread", async () => {
    const result = await testFormatting(`const merged = {...defaults,《...userConfig,...overrides》}`)
    expect(result).toMatchInlineSnapshot(`
      "const merged = { ...defaults, 《...userConfig, ...overrides 》};
      "
    `)
  })

  it("formats conditional expression", async () => {
    const result = await testFormatting(`const result = 《isValid ? processData(data) : handleError(error)》`)
    expect(result).toMatchInlineSnapshot(`
      "const result = 《isValid ? processData(data) : handleError(error);
      》"
    `)
  })

  it("formats destructuring with defaults", async () => {
    const result = await testFormatting(`const {《name="John",age=30,active=true》} = user`)
    expect(result).toMatchInlineSnapshot(`
      "const { 《name = "John", age = 30, active = true 》} = user;
      "
    `)
  })

  it("handles extreme print width causing single line to multi-line", async () => {
    const result = await testFormatting(
      `const obj = {《a:1,b:2,c:3,d:4,e:5,f:6,g:7,h:8,i:9,j:10,k:11,l:12,m:13,n:14,o:15,p:16》}`,
      { printWidth: 20 },
    )
    expect(result).toMatchInlineSnapshot(`
      "const obj = {
        《a: 1,
        b: 2,
        c: 3,
        d: 4,
        e: 5,
        f: 6,
        g: 7,
        h: 8,
        i: 9,
        j: 10,
        k: 11,
        l: 12,
        m: 13,
        n: 14,
        o: 15,
        p: 16,
      》};
      "
    `)
  })

  it("formats deeply nested ternary with JSX", async () => {
    const result = await testFormatting(
      `const Component = () => 《isLoading ? <Spinner /> : error ? <Error msg={error} /> : data ? <div>{data.map(item => <Item key={item.id} {...item} />)}</div> : <Empty />》`,
      { printWidth: 40 },
    )
    expect(result).toMatchInlineSnapshot(`
      "const Component = () =>
        《isLoading ? (
          <Spinner />
        ) : error ? (
          <Error msg={error} />
        ) : data ? (
          <div>
            {data.map((item) => (
              <Item key={item.id} {...item} />
            ))}
          </div>
        ) : (
          <Empty />
        );
      》"
    `)
  })

  it("handles complex generic type with constraints", async () => {
    const result = await testFormatting(
      `type Complex<T extends 《[{a:string,b:number},{c:boolean,d:T extends {a:string} ? string : number}]》> = T`,
    )
    expect(result).toMatchInlineSnapshot(`
      "type Complex<
        T extends 《[
          { a: string; b: number },
          { c: boolean; d: T extends { a: string } ? string : number },
        ],
      》> = T;
      "
    `)
  })

  it("formats mixed quotes in JSX attributes", async () => {
    const result = await testFormatting(
      `<Component 《attr1="value1" attr2='value2' attr3={"value3"} attr4={'value4'}》 />`,
      { jsxSingleQuote: true, singleQuote: false },
    )
    expect(result).toMatchInlineSnapshot(`
      "<Component 《attr1='value1' attr2='value2' attr3={"value3"} attr4={"value4"}》 />;
      "
    `)
  })

  it("handles semicolon insertion in ambiguous cases", async () => {
    const result = await testFormatting(
      `《const a = b
[1,2,3].forEach(x => console.log(x))》`,
      { semi: true },
    )
    expect(result).toMatchInlineSnapshot(`
      "《const a = b[(1, 2, 3)].forEach((x) => console.log(x));
      》"
    `)
  })

  it("formats complex destructuring with rename and defaults", async () => {
    const result = await testFormatting(
      `const {《a:aliasA="defaultA",b:{c:aliasC,d:[first,...rest]={}},...others》} = complex`,
    )
    expect(result).toMatchInlineSnapshot(`
      "const {
        《a: aliasA = "defaultA",
        b: { c: aliasC, d: [first, ...rest] = {} },
        ...others
      》} = complex;
      "
    `)
  })

  it("handles arrow function with destructured params and return type", async () => {
    const result = await testFormatting(
      `const fn = 《({a,b,c}:{a:string,b:number,c:boolean}):{result:string,success:boolean}=>({result:a+b,success:c})》`,
      { arrowParens: "always", printWidth: 40 },
    )
    expect(result).toMatchInlineSnapshot(`
      "const fn = 《({
        a,
        b,
        c,
      }: {
        a: string;
        b: number;
        c: boolean;
      }): {
        result: string;
        success: boolean;
      } => ({ result: a + b, success: c });
      》"
    `)
  })

  it("formats template literal with nested expressions", async () => {
    const result = await testFormatting(
      "const str = 《`Result: ${data.map(d => `- ${d.name}: ${d.value}`).join('\\n')}`》",
    )
    expect(result).toMatchInlineSnapshot(`
      "const str = 《\`Result: \${data.map((d) => \`- \${d.name}: \${d.value}\`).join("\\n")}\`;
      》"
    `)
  })

  it("handles class with decorators and parameter properties", async () => {
    const result = await testFormatting(
      `《@injectable()@singleton()class Service{constructor(@inject(TYPES.Database)private readonly db:IDatabase,@inject(TYPES.Logger)private logger:ILogger){}}》`,
      { printWidth: 50 },
    )
    expect(result).toMatchInlineSnapshot(`
      "《@injectable()
      @singleton()
      class Service {
        constructor(
          @inject(TYPES.Database)
          private readonly db: IDatabase,
          @inject(TYPES.Logger) private logger: ILogger,
        ) {}
      }
      》"
    `)
  })

  it("formats complex async generator with try-catch", async () => {
    const result = await testFormatting(
      `《async function*complexGenerator<T>(items:T[]):AsyncGenerator<T,void,unknown>{try{for(const item of items){yield await processItem(item)}}catch(e){console.error(e);throw e}}》`,
    )
    expect(result).toMatchInlineSnapshot(`
      "《async function* complexGenerator<T>(
        items: T[],
      ): AsyncGenerator<T, void, unknown> {
        try {
          for (const item of items) {
            yield await processItem(item);
          }
        } catch (e) {
          console.error(e);
          throw e;
        }
      }
      》"
    `)
  })

  it("handles mixed object and array destructuring", async () => {
    const result = await testFormatting(`const 《{data:[{id,name},...rest],meta:{total,page}}》 = response`)
    expect(result).toMatchInlineSnapshot(`
      "const 《{
        data: [{ id, name }, ...rest],
        meta: { total, page },
      }》 = response;
      "
    `)
  })

  it("formats function overloads with complex types", async () => {
    const result = await testFormatting(
      `《function process(input:string):string;function process(input:number):number;function process<T extends string|number>(input:T):T{return input}》`,
    )
    expect(result).toMatchInlineSnapshot(`
      "《function process(input: string): string;
      function process(input: number): number;
      function process<T extends string | number>(input: T): T {
        return input;
      }
      》"
    `)
  })

  it("handles JSX with spread props and children", async () => {
    const result = await testFormatting(
      `const el = 《<Parent {...parentProps}><Child {...childProps}>{items.map((item,i)=><Item key={i} {...item}/>)}</Child></Parent>》`,
      { printWidth: 30 },
    )
    expect(result).toMatchInlineSnapshot(`
      "const el = (
        《<Parent {...parentProps}>
          <Child {...childProps}>
            {items.map(
              (item, i) => (
                <Item
                  key={i}
                  {...item}
                />
              ),
            )}
          </Child>
        </Parent>
      );
      》"
    `)
  })

  it("formats complex type union with intersections", async () => {
    const result = await testFormatting(
      `type Combined = 《{a:string}&{b:number}|{c:boolean}&{d:string}|{e:T extends string ? {f:string} : {g:number}}》`,
    )
    expect(result).toMatchInlineSnapshot(`
      "type Combined =
        | (《{ a: string } & { b: number })
        | ({ c: boolean } & { d: string })
        | { e: T extends string ? { f: string } : { g: number } };
      》"
    `)
  })

  it("handles dynamic import with complex then chain", async () => {
    const result = await testFormatting(
      `《import('./module').then(({default:mod})=>mod.initialize()).then(instance=>instance.start()).catch(console.error)》`,
    )
    expect(result).toMatchInlineSnapshot(`
      "《import("./module")
        .then(({ default: mod }) => mod.initialize())
        .then((instance) => instance.start())
        .catch(console.error);
      》"
    `)
  })

  it("formats regex with unicode and flags", async () => {
    const result = await testFormatting(
      `const regex = 《/^(?:[a-z0-9!#$%&'*+/=?^_\`{|}~-]+(?:\\.[a-z0-9!#$%&'*+/=?^_\`{|}~-]+)*|"(?:[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x21\\x23-\\x5b\\x5d-\\x7f]|\\\\[\\x01-\\x09\\x0b\\x0c\\x0e-\\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x21-\\x5a\\x53-\\x7f]|\\\\[\\x01-\\x09\\x0b\\x0c\\x0e-\\x7f])+)\\])$/iu》`,
    )
    expect(result).toMatchInlineSnapshot(`
      "const regex =
        《/^(?:[a-z0-9!#$%&'*+/=?^_\`{|}~-]+(?:\\.[a-z0-9!#$%&'*+/=?^_\`{|}~-]+)*|"(?:[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x21\\x23-\\x5b\\x5d-\\x7f]|\\\\[\\x01-\\x09\\x0b\\x0c\\x0e-\\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x21-\\x5a\\x53-\\x7f]|\\\\[\\x01-\\x09\\x0b\\x0c\\x0e-\\x7f])+)\\])$/iu;
      》"
    `)
  })

  it("handles complex mapped types with template literals", async () => {
    const result = await testFormatting(
      `type Getters<T> = 《{[K in keyof T as \`get\${Capitalize<string & K>}\`]:()=>T[K]}&{[K in keyof T as \`set\${Capitalize<string & K>}\`]:(value:T[K])=>void}》`,
    )
    expect(result).toMatchInlineSnapshot(`
      "type Getters<T> = 《{
        [K in keyof T as \`get\${Capitalize<string & K>}\`]: () => T[K];
      } & { [K in keyof T as \`set\${Capitalize<string & K>}\`]: (value: T[K]) => void };
      》"
    `)
  })

  it("formats do-while with complex condition", async () => {
    const result = await testFormatting(
      `《do{result=await attemptOperation();retries++}while(!result.success&&retries<maxRetries&&Date.now()-startTime<timeout)》`,
    )
    expect(result).toMatchInlineSnapshot(`
      "《do {
        result = await attemptOperation();
        retries++;
      } while (
        !result.success &&
        retries < maxRetries &&
        Date.now() - startTime < timeout
      );
      》"
    `)
  })

  it("handles optional chaining with nullish coalescing", async () => {
    const result = await testFormatting(
      `const value = 《data?.user?.profile?.settings?.theme?.colors?.primary??data?.defaults?.theme?.colors?.primary??'#000000'》`,
    )
    expect(result).toMatchInlineSnapshot(`
      "const value =
        《data?.user?.profile?.settings?.theme?.colors?.primary ??
        data?.defaults?.theme?.colors?.primary ??
        "#000000";
      》"
    `)
  })

  it("formats complex array methods with type predicates", async () => {
    const result = await testFormatting(
      `const filtered = 《items.filter((item):item is ValidItem=>item.isValid&&item.data!==null).map(item=>({...item,processed:true})).reduce((acc,item)=>({...acc,[item.id]:item}),{})》`,
      { printWidth: 40 },
    )
    expect(result).toMatchInlineSnapshot(`
      "const filtered = 《items
        .filter(
          (item): item is ValidItem =>
            item.isValid &&
            item.data !== null,
        )
        .map((item) => ({
          ...item,
          processed: true,
        }))
        .reduce(
          (acc, item) => ({
            ...acc,
            [item.id]: item,
          }),
          {},
        );
      》"
    `)
  })
})

async function testFormatting(input: string, options: prettier.Options = {}): Promise<string> {
  const startMarker = "《"
  const endMarker = "》"

  // Find marker positions
  const startIdx = input.indexOf(startMarker)
  const endIdx = input.indexOf(endMarker)

  if (startIdx === -1 || endIdx === -1) {
    throw new Error("Missing 《 or 》 markers")
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
    ...options,
  })

  // Use mapFormattingPositions to map the positions
  const result = mapFormattingPositions(originalContent, formattedContent, originalStart, originalEnd)

  // Validate the formatted partial string
  // 1. Extract the original partial string and the formatted partial string
  const originalPartial = originalContent.slice(originalStart, originalEnd)
  const formattedPartial = result.newContent.slice(result.start, result.end)

  // 2. Replace the original partial with the formatted partial in the original content
  const replacedContent = originalContent.slice(0, originalStart) + formattedPartial + originalContent.slice(originalEnd)

  // 3. Try to format the replaced content to check for syntax errors
  let formattedReplacedContent: string
  try {
    formattedReplacedContent = await prettier.format(replacedContent, {
      parser: "typescript",
      printWidth: 80,
      tabWidth: 2,
      useTabs: false,
      semi: true,
      ...options,
    })
  } catch (error) {
    throw new Error(`Replacing original partial string with formatted partial string resulted in invalid code: ${error}`)
  }

  // 4. Verify that formatting the replaced content gives the same result as formatting the original
  if (formattedReplacedContent !== formattedContent) {
    throw new Error(
      `Semantic equivalence check failed. Replacing the partial string and formatting gives different result than formatting the original content.\n` +
      `Original partial: ${JSON.stringify(originalPartial)}\n` +
      `Formatted partial: ${JSON.stringify(formattedPartial)}\n` +
      `Expected: ${JSON.stringify(formattedContent)}\n` +
      `Got: ${JSON.stringify(formattedReplacedContent)}`
    )
  }

  // Insert markers at the mapped positions
  return insertMarkers(result.newContent, result.start, result.end)
}

function insertMarkers(text: string, start: number, end: number): string {
  return text.slice(0, start) + "《" + text.slice(start, end) + "》" + text.slice(end)
}
