declare module "bun" {
  namespace WebAssembly {
    type ImportExportKind = "function" | "global" | "memory" | "table" | "tag";
    type TableKind = "anyfunc" | "externref";
    type ExportValue = Function | Global | WebAssembly.Memory | WebAssembly.Table;
    type Exports = Record<string, ExportValue>;
    type ImportValue = ExportValue | number;
    type Imports = Record<string, ModuleImports>;
    type ModuleImports = Record<string, ImportValue>;

    interface ValueTypeMap {
      anyfunc: Function;
      externref: any;
      f32: number;
      f64: number;
      i32: number;
      i64: bigint;
      v128: never;
    }

    type ValueType = keyof ValueTypeMap;

    interface GlobalDescriptor<T extends ValueType = ValueType> {
      mutable?: boolean;
      value: T;
    }

    interface Global<T extends ValueType = ValueType> {
      // <T extends ValueType = ValueType> {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Global/value) */
      value: ValueTypeMap[T];
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Global/valueOf) */
      valueOf(): ValueTypeMap[T];
    }

    interface CompileError extends Error {}

    interface LinkError extends Error {}

    interface RuntimeError extends Error {}

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Instance) */
    interface Instance {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Instance/exports) */
      readonly exports: Exports;
    }

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Memory) */
    interface Memory {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Memory/buffer) */
      readonly buffer: ArrayBuffer;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Memory/grow) */
      grow(delta: number): number;
    }

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Module) */
    interface Module {}

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Table) */
    interface Table {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Table/length) */
      readonly length: number;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Table/get) */
      get(index: number): any;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Table/grow) */
      grow(delta: number, value?: any): number;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Table/set) */
      set(index: number, value?: any): void;
    }

    interface MemoryDescriptor {
      initial: number;
      maximum?: number;
      shared?: boolean;
    }

    interface ModuleExportDescriptor {
      kind: ImportExportKind;
      name: string;
    }

    interface ModuleImportDescriptor {
      kind: ImportExportKind;
      module: string;
      name: string;
    }

    interface TableDescriptor {
      element: TableKind;
      initial: number;
      maximum?: number;
    }

    interface WebAssemblyInstantiatedSource {
      instance: Instance;
      module: Module;
    }
  }
}

declare namespace WebAssembly {
  interface ValueTypeMap extends Bun.WebAssembly.ValueTypeMap {}
  interface GlobalDescriptor<T extends keyof ValueTypeMap = keyof ValueTypeMap> extends Bun.WebAssembly
    .GlobalDescriptor<T> {}
  interface MemoryDescriptor extends Bun.WebAssembly.MemoryDescriptor {}
  interface ModuleExportDescriptor extends Bun.WebAssembly.ModuleExportDescriptor {}
  interface ModuleImportDescriptor extends Bun.WebAssembly.ModuleImportDescriptor {}
  interface TableDescriptor extends Bun.WebAssembly.TableDescriptor {}
  interface WebAssemblyInstantiatedSource extends Bun.WebAssembly.WebAssemblyInstantiatedSource {}

  interface LinkError extends Bun.WebAssembly.LinkError {}
  var LinkError: {
    prototype: LinkError;
    new (message?: string): LinkError;
    (message?: string): LinkError;
  };

  interface CompileError extends Bun.WebAssembly.CompileError {}
  var CompileError: {
    prototype: CompileError;
    new (message?: string): CompileError;
    (message?: string): CompileError;
  };

  interface RuntimeError extends Bun.WebAssembly.RuntimeError {}
  var RuntimeError: {
    prototype: RuntimeError;
    new (message?: string): RuntimeError;
    (message?: string): RuntimeError;
  };

  interface Global<T extends keyof ValueTypeMap = keyof ValueTypeMap> extends Bun.WebAssembly.Global<T> {}
  var Global: {
    prototype: Global;
    new <T extends Bun.WebAssembly.ValueType = Bun.WebAssembly.ValueType>(
      descriptor: GlobalDescriptor<T>,
      v?: ValueTypeMap[T],
    ): Global<T>;
  };

  interface Instance extends Bun.WebAssembly.Instance {}
  var Instance: Bun.__internal.UseLibDomIfAvailable<
    "WebAssembly",
    {
      Instance: {
        prototype: Instance;
        new (module: Module, importObject?: Bun.WebAssembly.Imports): Instance;
      };
    }
  >["Instance"];

  interface Memory extends Bun.WebAssembly.Memory {}
  var Memory: {
    prototype: Memory;
    new (descriptor: MemoryDescriptor): Memory;
  };

  interface Module extends Bun.WebAssembly.Module {}
  var Module: Bun.__internal.UseLibDomIfAvailable<
    "WebAssembly",
    {
      Module: {
        prototype: Module;
        new (bytes: Bun.BufferSource): Module;
        /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Module/customSections) */
        customSections(moduleObject: Module, sectionName: string): ArrayBuffer[];
        /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Module/exports) */
        exports(moduleObject: Module): ModuleExportDescriptor[];
        /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Module/imports) */
        imports(moduleObject: Module): ModuleImportDescriptor[];
      };
    }
  >["Module"];

  interface Table extends Bun.WebAssembly.Table {}
  var Table: {
    prototype: Table;
    new (descriptor: TableDescriptor, value?: any): Table;
  };

  /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/compile) */
  function compile(bytes: Bun.BufferSource): Promise<Module>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/compileStreaming) */
  function compileStreaming(source: Response | PromiseLike<Response>): Promise<Module>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/instantiate) */
  function instantiate(
    bytes: Bun.BufferSource,
    importObject?: Bun.WebAssembly.Imports,
  ): Promise<WebAssemblyInstantiatedSource>;
  function instantiate(moduleObject: Module, importObject?: Bun.WebAssembly.Imports): Promise<Instance>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/instantiateStreaming) */
  function instantiateStreaming(
    source: Response | PromiseLike<Response>,
    importObject?: Bun.WebAssembly.Imports,
  ): Promise<WebAssemblyInstantiatedSource>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/validate) */
  function validate(bytes: Bun.BufferSource): boolean;
}
