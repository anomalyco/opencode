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
    const result = await testFormatting(`const fn = (《x) => x * 2》;`, { arrowParens: "always" })
    expect(result).toMatchInlineSnapshot(`
      "const fn = (《x) => x * 2》;
      "
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
    const result = await testFormatting(`return (
  《<div><span>text</span></div>》
);`)
    expect(result).toMatchInlineSnapshot(`
      "return (
        《<div>
          <span>text</span>
        </div>》
      );
      "
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
      `namespace Services {
  export 《class Service{constructor(private db:DB){}getUser(id:string){return this.db.find(id)}}》
}`,
    )
    expect(result).toMatchInlineSnapshot(`
      "namespace Services {
        export 《class Service {
          constructor(private db: DB) {}
          getUser(id: string) {
            return this.db.find(id);
          }
        }》
      }
      "
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
    const result = await testFormatting(`《try{doSomething()}catch(e){console.error(e)}》`)
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
    const result = await testFormatting(`return (
  《<><div>A</div><div>B</div></>》
);`)
    expect(result).toMatchInlineSnapshot(`
      "return (
        《<>
          <div>A</div>
          <div>B</div>
        </>》
      );
      "
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
      `const Component = () =>
  《isLoading ? <Spinner /> : error ? <Error msg={error} /> : data ? <div>{data.map(item => <Item key={item.id} {...item} />)}</div> : <Empty />》;`,
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
        )》;
      "
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
      `const fn: ComplexHandler = 《({a,b,c}:{a:string,b:number,c:boolean}):{result:string,success:boolean}=>({result:a+b,success:c})》;`,
      { arrowParens: "always", printWidth: 40 },
    )
    expect(result).toMatchInlineSnapshot(`
      "const fn: ComplexHandler = 《({
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
      } => ({ result: a + b, success: c })》;
      "
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
      `export 《@injectable()@singleton()class Service{constructor(@inject(TYPES.Database)private readonly db:IDatabase,@inject(TYPES.Logger)private logger:ILogger){}}》

const serviceInstance = new Service(db, logger);`,
      { printWidth: 50 },
    )
    expect(result).toMatchInlineSnapshot(`
      "export
      《@injectable()
      @singleton()
      class Service {
        constructor(
          @inject(TYPES.Database)
          private readonly db: IDatabase,
          @inject(TYPES.Logger) private logger: ILogger,
        ) {}
      }》

      const serviceInstance = new Service(db, logger);
      "
    `)
  })

  it("formats complex async generator with try-catch", async () => {
    const result = await testFormatting(
      `export 《async function*complexGenerator<T>(items:T[]):AsyncGenerator<T,void,unknown>{try{for(const item of items){yield await processItem(item)}}catch(e){console.error(e);throw e}}》

export default complexGenerator;`,
    )
    expect(result).toMatchInlineSnapshot(`
      "export 《async function* complexGenerator<T>(
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
      }》

      export default complexGenerator;
      "
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
      `export namespace Utils {
  《function process(input:string):string;function process(input:number):number;function process<T extends string|number>(input:T):T{return input}》
}`,
    )
    expect(result).toMatchInlineSnapshot(`
      "export namespace Utils {
        《function process(input: string): string;
        function process(input: number): number;
        function process<T extends string | number>(input: T): T {
          return input;
        }》
      }
      "
    `)
  })

  it("handles JSX with spread props and children", async () => {
    const result = await testFormatting(
      `const el = (
  《<Parent {...parentProps}><Child {...childProps}>{items.map((item,i)=><Item key={i} {...item}/>)}</Child></Parent>》
);`,
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
        </Parent>》
      );
      "
    `)
  })

  it("formats complex type union with intersections", async () => {
    const result = await testFormatting(
      `type Combined =
  | (《{a:string}&{b:number}》)
  | ({c:boolean}&{d:string})
  | {e:T extends string ? {f:string} : {g:number}};`,
    )
    expect(result).toMatchInlineSnapshot(`
      "type Combined =
        | (《{ a: string } & { b: number }》)
        | ({ c: boolean } & { d: string })
        | { e: T extends string ? { f: string } : { g: number } };
      "
    `)
  })

  it("handles dynamic import with complex then chain", async () => {
    const result = await testFormatting(
      `const loader = () => 《import('./module').then(({default:mod})=>mod.initialize()).then(instance=>instance.start()).catch(console.error)》;`,
    )
    expect(result).toMatchInlineSnapshot(`
      "const loader = () =>
        《import("./module")
          .then(({ default: mod }) => mod.initialize())
          .then((instance) => instance.start())
          .catch(console.error)》;
      "
    `)
  })

  it("formats regex with unicode and flags", async () => {
    const result = await testFormatting(
      `const emailRegex: RegExp = 《/^(?:[a-z0-9!#$%&'*+/=?^_\`{|}~-]+(?:\\.[a-z0-9!#$%&'*+/=?^_\`{|}~-]+)*|"(?:[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x21\\x23-\\x5b\\x5d-\\x7f]|\\\\[\\x01-\\x09\\x0b\\x0c\\x0e-\\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x21-\\x5a\\x53-\\x7f]|\\\\[\\x01-\\x09\\x0b\\x0c\\x0e-\\x7f])+)\\])$/iu》;
export { emailRegex };`,
    )
    expect(result).toMatchInlineSnapshot(`
      "const emailRegex: RegExp =
        《/^(?:[a-z0-9!#$%&'*+/=?^_\`{|}~-]+(?:\\.[a-z0-9!#$%&'*+/=?^_\`{|}~-]+)*|"(?:[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x21\\x23-\\x5b\\x5d-\\x7f]|\\\\[\\x01-\\x09\\x0b\\x0c\\x0e-\\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x21-\\x5a\\x53-\\x7f]|\\\\[\\x01-\\x09\\x0b\\x0c\\x0e-\\x7f])+)\\])$/iu》;
      export { emailRegex };
      "
    `)
  })

  it("handles complex mapped types with template literals", async () => {
    const result = await testFormatting(
      `export type Getters<T> = 《{[K in keyof T as \`get\${Capitalize<string & K>}\`]:()=>T[K]}&{[K in keyof T as \`set\${Capitalize<string & K>}\`]:(value:T[K])=>void}》;

type UserGetters = Getters<User>;`,
    )
    expect(result).toMatchInlineSnapshot(`
      "export type Getters<T> = 《{
        [K in keyof T as \`get\${Capitalize<string & K>}\`]: () => T[K];
      } & { [K in keyof T as \`set\${Capitalize<string & K>}\`]: (value: T[K]) => void }》;

      type UserGetters = Getters<User>;
      "
    `)
  })

  it("formats do-while with complex condition", async () => {
    const result = await testFormatting(
      `async function retry() {
  《do{result=await attemptOperation();retries++}while(!result.success&&retries<maxRetries&&Date.now()-startTime<timeout)》;
  return result;
}`,
    )
    expect(result).toMatchInlineSnapshot(`
      "async function retry() {
        《do {
          result = await attemptOperation();
          retries++;
        } while (
          !result.success &&
          retries < maxRetries &&
          Date.now() - startTime < timeout
        )》;
        return result;
      }
      "
    `)
  })

  it("handles optional chaining with nullish coalescing", async () => {
    const result = await testFormatting(
      `const getThemeColor = (data: AppData) => {
  const value = 《data?.user?.profile?.settings?.theme?.colors?.primary??data?.defaults?.theme?.colors?.primary??'#000000'》;
  return value;
};`,
    )
    expect(result).toMatchInlineSnapshot(`
      "const getThemeColor = (data: AppData) => {
        const value =
          《data?.user?.profile?.settings?.theme?.colors?.primary ??
          data?.defaults?.theme?.colors?.primary ??
          "#000000"》;
        return value;
      };
      "
    `)
  })

  it("formats complex array methods with type predicates", async () => {
    const result = await testFormatting(
      `function processItems(items: Item[]): Record<string, ProcessedItem> {
  const filtered = 《items.filter((item):item is ValidItem=>item.isValid&&item.data!==null).map(item=>({...item,processed:true})).reduce((acc,item)=>({...acc,[item.id]:item}),{})》;
  return filtered;
}`,
      { printWidth: 40 },
    )
    expect(result).toMatchInlineSnapshot(`
      "function processItems(
        items: Item[],
      ): Record<string, ProcessedItem> {
        const filtered = 《items
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
          )》;
        return filtered;
      }
      "
    `)
  })

  describe("complex edge cases with significant transformations", () => {
    it("handles minified object with complex nesting", async () => {
      const result = await testFormatting(
        `const config = {
  api: {
    《url:"https://api.example.com",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},retry:{attempts:3,delay:1000,backoff:2},transformResponse:data=>({...data,timestamp:Date.now()})》
  }
};`,
      )
      expect(result).toMatchInlineSnapshot(`
        "const config = {
          api: {
            《url: "https://api.example.com",
            headers: {
              Authorization: "Bearer " + token,
              "Content-Type": "application/json",
            },
            retry: { attempts: 3, delay: 1000, backoff: 2 },
            transformResponse: (data) => ({ ...data, timestamp: Date.now() }),》
          },
        };
        "
      `)
    })

    it("handles deeply nested ternary with mixed content", async () => {
      const result = await testFormatting(
        `const Component = () => (
  <div>
    {《loading?<Spinner/>:error?<Alert type="error">{error.message}</Alert>:data?.items?.length>0?data.items.map(item=><Card key={item.id}>{item.name}</Card>):<Empty/>》}
  </div>
);`,
      )
      expect(result).toMatchInlineSnapshot(`
        "const Component = () => (
          <div>
            {《loading ? (
              <Spinner />
            ) : error ? (
              <Alert type="error">{error.message}</Alert>
            ) : data?.items?.length > 0 ? (
              data.items.map((item) => <Card key={item.id}>{item.name}</Card>)
            ) : (
              <Empty />
            )》}
          </div>
        );
        "
      `)
    })

    it("handles inline async function with error handling", async () => {
      const result = await testFormatting(
        `const handler = 《async(req,res)=>{try{const{id,data}=req.body;if(!id||!data)return res.status(400).json({error:"Missing required fields"});const result=await db.update(id,data);res.json({success:true,result})}catch(e){console.error(e);res.status(500).json({error:"Internal server error"})}}》;`,
      )
      expect(result).toMatchInlineSnapshot(`
        "const handler = 《async (req, res) => {
          try {
            const { id, data } = req.body;
            if (!id || !data)
              return res.status(400).json({ error: "Missing required fields" });
            const result = await db.update(id, data);
            res.json({ success: true, result });
          } catch (e) {
            console.error(e);
            res.status(500).json({ error: "Internal server error" });
          }
        }》;
        "
      `)
    })

    it("handles complex type definition with conditional types", async () => {
      const result = await testFormatting(
        `type ApiResponse<T> =
  | {
      《status:"success";data:T;metadata:{timestamp:number;version:string;};errors?:never》
    }
  | {status:"error";data?:never;metadata?:never;errors:Array<{code:string;message:string;field?:string}>};`,
      )
      expect(result).toMatchInlineSnapshot(`
        "type ApiResponse<T> =
          | {
              《status: "success";
              data: T;
              metadata: { timestamp: number; version: string };
              errors?: never;》
            }
          | {
              status: "error";
              data?: never;
              metadata?: never;
              errors: Array<{ code: string; message: string; field?: string }>;
            };
        "
      `)
    })

    it("handles inline array of functions with mixed syntax", async () => {
      const result = await testFormatting(
        `const middlewares = [
  《(req,res,next)=>{console.log(req.url);next()},async(req,res,next)=>{try{req.user=await authenticate(req.headers.authorization);next()}catch(e){res.status(401).json({error:"Unauthorized"})}},function rateLimit(req,res,next){if(requests[req.ip]>100)return res.status(429).json({error:"Too many requests"});next()}》
];`,
      )
      expect(result).toMatchInlineSnapshot(`
        "const middlewares = [
          《(req, res, next) => {
            console.log(req.url);
            next();
          },
          async (req, res, next) => {
            try {
              req.user = await authenticate(req.headers.authorization);
              next();
            } catch (e) {
              res.status(401).json({ error: "Unauthorized" });
            }
          },
          function rateLimit(req, res, next) {
            if (requests[req.ip] > 100)
              return res.status(429).json({ error: "Too many requests" });
            next();
          },》
        ];
        "
      `)
    })

    it("handles compact class with decorators and methods", async () => {
      const result = await testFormatting(
        `@Injectable()
class UserService {
  《constructor(private db:Database,private cache:Cache,private logger:Logger){}async getUser(id:string){const cached=await this.cache.get(\`user:\${id}\`);if(cached)return cached;const user=await this.db.findOne({id});if(user)await this.cache.set(\`user:\${id}\`,user,3600);return user}async updateUser(id:string,data:Partial<User>){await this.db.update({id},data);await this.cache.delete(\`user:\${id}\`);this.logger.info(\`Updated user \${id}\`);}》
}`,
      )
      expect(result).toMatchInlineSnapshot(`
        "@Injectable()
        class UserService {
          《constructor(
            private db: Database,
            private cache: Cache,
            private logger: Logger,
          ) {}
          async getUser(id: string) {
            const cached = await this.cache.get(\`user:\${id}\`);
            if (cached) return cached;
            const user = await this.db.findOne({ id });
            if (user) await this.cache.set(\`user:\${id}\`, user, 3600);
            return user;
          }
          async updateUser(id: string, data: Partial<User>) {
            await this.db.update({ id }, data);
            await this.cache.delete(\`user:\${id}\`);
            this.logger.info(\`Updated user \${id}\`);
          }》
        }
        "
      `)
    })

    it("handles minified React component with hooks", async () => {
      const result = await testFormatting(
        `function TodoList() {
  《const[todos,setTodos]=useState([]);const[input,setInput]=useState("");const[filter,setFilter]=useState("all");const filtered=useMemo(()=>filter==="all"?todos:filter==="active"?todos.filter(t=>!t.done):todos.filter(t=>t.done),[todos,filter]);return(<div><input value={input} onChange={e=>setInput(e.target.value)}/><button onClick={()=>{if(input.trim()){setTodos([...todos,{id:Date.now(),text:input,done:false}]);setInput("")}}}>Add</button><ul>{filtered.map(todo=><li key={todo.id}><input type="checkbox" checked={todo.done} onChange={()=>setTodos(todos.map(t=>t.id===todo.id?{...t,done:!t.done}:t))}/>{todo.text}</li>)}</ul></div>)》;
}`,
      )
      expect(result).toMatchInlineSnapshot(`
        "function TodoList() {
          《const [todos, setTodos] = useState([]);
          const [input, setInput] = useState("");
          const [filter, setFilter] = useState("all");
          const filtered = useMemo(
            () =>
              filter === "all"
                ? todos
                : filter === "active"
                  ? todos.filter((t) => !t.done)
                  : todos.filter((t) => t.done),
            [todos, filter],
          );
          return (
            <div>
              <input value={input} onChange={(e) => setInput(e.target.value)} />
              <button
                onClick={() => {
                  if (input.trim()) {
                    setTodos([...todos, { id: Date.now(), text: input, done: false }]);
                    setInput("");
                  }
                }}
              >
                Add
              </button>
              <ul>
                {filtered.map((todo) => (
                  <li key={todo.id}>
                    <input
                      type="checkbox"
                      checked={todo.done}
                      onChange={() =>
                        setTodos(
                          todos.map((t) =>
                            t.id === todo.id ? { ...t, done: !t.done } : t,
                          ),
                        )
                      }
                    />
                    {todo.text}
                  </li>
                ))}
              </ul>
            </div>
          )》;
        }
        "
      `)
    })

    it("handles promise chain with mixed async patterns", async () => {
      const result = await testFormatting(
        `const processData = () => {
  《fetch(url).then(r=>r.ok?r.json():Promise.reject(new Error(\`HTTP \${r.status}\`))).then(async data=>{const processed=await transformData(data);const validated=validateSchema(processed);if(!validated.valid)throw new Error("Invalid data: "+validated.errors.join(", "));return saveToDatabase(validated.data)}).then(saved=>({success:true,id:saved.id,timestamp:Date.now()})).catch(err=>{console.error("Processing failed:",err);return{success:false,error:err.message}})》
};`,
      )
      expect(result).toMatchInlineSnapshot(`
        "const processData = () => {
          《fetch(url)
            .then((r) =>
              r.ok ? r.json() : Promise.reject(new Error(\`HTTP \${r.status}\`)),
            )
            .then(async (data) => {
              const processed = await transformData(data);
              const validated = validateSchema(processed);
              if (!validated.valid)
                throw new Error("Invalid data: " + validated.errors.join(", "));
              return saveToDatabase(validated.data);
            })
            .then((saved) => ({ success: true, id: saved.id, timestamp: Date.now() }))
            .catch((err) => {
              console.error("Processing failed:", err);
              return { success: false, error: err.message };
            });》
        };
        "
      `)
    })
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
  const replacedContent =
    originalContent.slice(0, originalStart) + formattedPartial + originalContent.slice(originalEnd)

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
    throw new Error(
      `Replacing original partial string with formatted partial string resulted in invalid code: ${error}`,
    )
  }

  // 4. Verify that formatting the replaced content gives the same result as formatting the original
  if (formattedReplacedContent !== formattedContent) {
    throw new Error(
      `Semantic equivalence check failed. Replacing the partial string and formatting gives different result than formatting the original content.\n` +
        `Original partial: ${JSON.stringify(originalPartial)}\n` +
        `Formatted partial: ${JSON.stringify(formattedPartial)}\n` +
        `Expected: ${JSON.stringify(formattedContent)}\n` +
        `Got: ${JSON.stringify(formattedReplacedContent)}`,
    )
  }

  // Insert markers at the mapped positions
  return insertMarkers(result.newContent, result.start, result.end)
}

function insertMarkers(text: string, start: number, end: number): string {
  return text.slice(0, start) + "《" + text.slice(start, end) + "》" + text.slice(end)
}
