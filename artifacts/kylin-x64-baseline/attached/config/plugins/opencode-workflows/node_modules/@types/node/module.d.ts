/**
 * @since v0.3.7
 */
declare module "module" {
    import { URL } from "node:url";
    import { MessagePort } from "node:worker_threads";
    class Module {
        constructor(id: string, parent?: Module);
    }
    interface Module extends NodeJS.Module {}
    namespace Module {
        export { Module };
    }
    namespace Module {
        /**
         * A list of the names of all modules provided by Node.js. Can be used to verify
         * if a module is maintained by a third party or not.
         *
         * Note: the list doesn't contain prefix-only modules like `node:test`.
         * @since v9.3.0, v8.10.0, v6.13.0
         */
        const builtinModules: readonly string[];
        /**
         * @since v12.2.0
         * @param path Filename to be used to construct the require
         * function. Must be a file URL object, file URL string, or absolute path
         * string.
         */
        function createRequire(path: string | URL): NodeJS.Require;
        /**
         * @since v18.6.0, v16.17.0
         */
        function isBuiltin(moduleName: string): boolean;
        interface RegisterOptions<Data> {
            /**
             * If you want to resolve `specifier` relative to a
             * base URL, such as `import.meta.url`, you can pass that URL here. This
             * property is ignored if the `parentURL` is supplied as the second argument.
             * @default 'data:'
             */
            parentURL?: string | URL | undefined;
            /**
             * Any arbitrary, cloneable JavaScript value to pass into the
             * {@link initialize} hook.
             */
            data?: Data | undefined;
            /**
             * [Transferable objects](https://nodejs.org/docs/latest-v20.x/api/worker_threads.html#portpostmessagevalue-transferlist)
             * to be passed into the `initialize` hook.
             */
            transferList?: any[] | undefined;
        }
        /* eslint-disable @definitelytyped/no-unnecessary-generics */
        /**
         * Register a module that exports hooks that customize Node.js module
         * resolution and loading behavior. See
         * [Customization hooks](https://nodejs.org/docs/latest-v20.x/api/module.html#customization-hooks).
         * @since v20.6.0, v18.19.0
         * @param specifier Customization hooks to be registered; this should be
         * the same string that would be passed to `import()`, except that if it is
         * relative, it is resolved relative to `parentURL`.
         * @param parentURL f you want to resolve `specifier` relative to a base
         * URL, such as `import.meta.url`, you can pass that URL here.
         */
        function register<Data = any>(
            specifier: string | URL,
            parentURL?: string | URL,
            options?: RegisterOptions<Data>,
        ): void;
        function register<Data = any>(specifier: string | URL, options?: RegisterOptions<Data>): void;
        /* eslint-enable @definitelytyped/no-unnecessary-generics */
        /**
         * The `module.syncBuiltinESMExports()` method updates all the live bindings for
         * builtin `ES Modules` to match the properties of the `CommonJS` exports. It
         * does not add or remove exported names from the `ES Modules`.
         *
         * ```js
         * import fs from 'node:fs';
         * import assert from 'node:assert';
         * import { syncBuiltinESMExports } from 'node:module';
         *
         * fs.readFile = newAPI;
         *
         * delete fs.readFileSync;
         *
         * function newAPI() {
         *   // ...
         * }
         *
         * fs.newAPI = newAPI;
         *
         * syncBuiltinESMExports();
         *
         * import('node:fs').then((esmFS) => {
         *   // It syncs the existing readFile property with the new value
         *   assert.strictEqual(esmFS.readFile, newAPI);
         *   // readFileSync has been deleted from the required fs
         *   assert.strictEqual('readFileSync' in fs, false);
         *   // syncBuiltinESMExports() does not remove readFileSync from esmFS
         *   assert.strictEqual('readFileSync' in esmFS, true);
         *   // syncBuiltinESMExports() does not add names
         *   assert.strictEqual(esmFS.newAPI, undefined);
         * });
         * ```
         * @since v12.12.0
         */
        function syncBuiltinESMExports(): void;
        /** @deprecated Use `ImportAttributes` instead */
        interface ImportAssertions extends ImportAttributes {}
        interface ImportAttributes extends NodeJS.Dict<string> {
            type?: string | undefined;
        }
        type ModuleFormat = "builtin" | "commonjs" | "json" | "module" | "wasm";
        type ModuleSource = string | ArrayBuffer | NodeJS.TypedArray;
        /**
         * The `initialize` hook provides a way to define a custom function that runs in
         * the hooks thread when the hooks module is initialized. Initialization happens
         * when the hooks module is registered via {@link register}.
         *
         * This hook can receive data from a {@link register} invocation, including
         * ports and other transferable objects. The return value of `initialize` can be a
         * `Promise`, in which case it will be awaited before the main application thread
         * execution resumes.
         */
        type InitializeHook<Data = any> = (data: Data) => void | Promise<void>;
        interface ResolveHookContext {
            /**
             * Export conditions of the relevant `package.json`
             */
            conditions: string[];
            /**
             * @deprecated Use `importAttributes` instead
             */
            importAssertions: ImportAttributes;
            /**
             *  An object whose key-value pairs represent the assertions for the module to import
             */
            importAttributes: ImportAttributes;
            /**
             * The module importing this one, or undefined if this is the Node.js entry point
             */
            parentURL: string | undefined;
        }
        interface ResolveFnOutput {
            /**
             * A hint to the load hook (it might be ignored)
             */
            format?: ModuleFormat | null | undefined;
            /**
             * @deprecated Use `importAttributes` instead
             */
            importAssertions?: ImportAttributes | undefined;
            /**
             * The import attributes to use when caching the module (optional; if excluded the input will be used)
             */
            importAttributes?: ImportAttributes | undefined;
            /**
             * A signal that this hook intends to terminate the chain of `resolve` hooks.
             * @default false
             */
            shortCircuit?: boolean | undefined;
            /**
             * The absolute URL to which this input resolves
             */
            url: string;
        }
        /**
         * The `resolve` hook chain is responsible for telling Node.js where to find and
         * how to cache a given `import` statement or expression, or `require` call. It can
         * optionally return a format (such as `'module'`) as a hint to the `load` hook. If
         * a format is specified, the `load` hook is ultimately responsible for providing
         * the final `format` value (and it is free to ignore the hint provided by
         * `resolve`); if `resolve` provides a `format`, a custom `load` hook is required
         * even if only to pass the value to the Node.js default `load` hook.
         */
        type ResolveHook = (
            specifier: string,
            context: ResolveHookContext,
            nextResolve: (
                specifier: string,
                context?: Partial<ResolveHookContext>,
            ) => ResolveFnOutput | Promise<ResolveFnOutput>,
        ) => ResolveFnOutput | Promise<ResolveFnOutput>;
        interface LoadHookContext {
            /**
             * Export conditions of the relevant `package.json`
             */
            conditions: string[];
            /**
             * The format optionally supplied by the `resolve` hook chain
             */
            format: ModuleFormat | null | undefined;
            /**
             * @deprecated Use `importAttributes` instead
             */
            importAssertions: ImportAttributes;
            /**
             *  An object whose key-value pairs represent the assertions for the module to import
             */
            importAttributes: ImportAttributes;
        }
        interface LoadFnOutput {
            format: string | null | undefined;
            /**
             * A signal that this hook intends to terminate the chain of `resolve` hooks.
             * @default false
             */
            shortCircuit?: boolean | undefined;
            /**
             * The source for Node.js to evaluate
             */
            source?: ModuleSource | undefined;
        }
        /**
         * The `load` hook provides a way to define a custom method of determining how a
         * URL should be interpreted, retrieved, and parsed. It is also in charge of
         * validating the import attributes.
         */
        type LoadHook = (
            url: string,
            context: LoadHookContext,
            nextLoad: (
                url: string,
                context?: Partial<LoadHookContext>,
            ) => LoadFnOutput | Promise<LoadFnOutput>,
        ) => LoadFnOutput | Promise<LoadFnOutput>;
        interface GlobalPreloadContext {
            port: MessagePort;
        }
        /**
         * Sometimes it might be necessary to run some code inside of the same global
         * scope that the application runs in. This hook allows the return of a string
         * that is run as a sloppy-mode script on startup.
         * @deprecated This hook will be removed in a future version. Use
         * `initialize` instead. When a hooks module has an `initialize` export,
         * `globalPreload` will be ignored.
         */
        type GlobalPreloadHook = (context: GlobalPreloadContext) => string;
        /**
         * `path` is the resolved path for the file for which a corresponding source map
         * should be fetched.
         * @since v13.7.0, v12.17.0
         * @return Returns `module.SourceMap` if a source map is found, `undefined` otherwise.
         */
        function findSourceMap(path: string): SourceMap | undefined;
        interface SourceMapConstructorOptions {
            /**
             * @since v20.5.0
             */
            lineLengths?: readonly number[] | undefined;
        }
        interface SourceMapPayload {
            file: string;
            version: number;
            sources: string[];
            sourcesContent: string[];
            names: string[];
            mappings: string;
            sourceRoot: string;
        }
        interface SourceMapping {
            generatedLine: number;
            generatedColumn: number;
            originalSource: string;
            originalLine: number;
            originalColumn: number;
        }
        interface SourceOrigin {
            /**
             * The name of the range in the source map, if one was provided
             */
            name: string | undefined;
            /**
             * The file name of the original source, as reported in the SourceMap
             */
            fileName: string;
            /**
             * The 1-indexed lineNumber of the corresponding call site in the original source
             */
            lineNumber: number;
            /**
             * The 1-indexed columnNumber of the corresponding call site in the original source
             */
            columnNumber: number;
        }
        /**
         * @since v13.7.0, v12.17.0
         */
        class SourceMap {
            constructor(payload: SourceMapPayload, options?: SourceMapConstructorOptions);
            /**
             * Getter for the payload used to construct the `SourceMap` instance.
             */
            readonly payload: SourceMapPayload;
            /**
             * Given a line offset and column offset in the generated source
             * file, returns an object representing the SourceMap range in the
             * original file if found, or an empty object if not.
             *
             * The object returned contains the following keys:
             *
             * The returned value represents the raw range as it appears in the
             * SourceMap, based on zero-indexed offsets, _not_ 1-indexed line and
             * column numbers as they appear in Error messages and CallSite
             * objects.
             *
             * To get the corresponding 1-indexed line and column numbers from a
             * lineNumber and columnNumber as they are reported by Error stacks
             * and CallSite objects, use `sourceMap.findOrigin(lineNumber, columnNumber)`
             * @param lineOffset The zero-indexed line number offset in the generated source
             * @param columnOffset The zero-indexed column number offset in the generated source
             */
            findEntry(lineOffset: number, columnOffset: number): SourceMapping | {};
            /**
             * Given a 1-indexed `lineNumber` and `columnNumber` from a call site in the generated source,
             * find the corresponding call site location in the original source.
             *
             * If the `lineNumber` and `columnNumber` provided are not found in any source map,
             * then an empty object is returned.
             * @param lineNumber The 1-indexed line number of the call site in the generated source
             * @param columnNumber The 1-indexed column number of the call site in the generated source
             */
            findOrigin(lineNumber: number, columnNumber: number): SourceOrigin | {};
        }
        function runMain(main?: string): void;
        function wrap(script: string): string;
    }
    global {
        interface ImportMeta {
            /**
             * The directory name of the current module. This is the same as the `path.dirname()` of the `import.meta.filename`.
             * **Caveat:** only present on `file:` modules.
             */
            dirname: string;
            /**
             * The full absolute path and filename of the current module, with symlinks resolved.
             * This is the same as the `url.fileURLToPath()` of the `import.meta.url`.
             * **Caveat:** only local modules support this property. Modules not using the `file:` protocol will not provide it.
             */
            filename: string;
            /**
             * The absolute `file:` URL of the module.
             */
            url: string;
            /**
             * Provides a module-relative resolution function scoped to each module, returning
             * the URL string.
             *
             * Second `parent` parameter is only used when the `--experimental-import-meta-resolve`
             * command flag enabled.
             *
             * @since v20.6.0
             *
             * @param specifier The module specifier to resolve relative to `parent`.
             * @param parent The absolute parent module URL to resolve from.
             * @returns The absolute (`file:`) URL string for the resolved module.
             */
            resolve(specifier: string, parent?: string | URL | undefined): string;
        }
        namespace NodeJS {
            interface Module {
                /**
                 * The module objects required for the first time by this one.
                 * @since v0.1.16
                 */
                children: Module[];
                /**
                 * The `module.exports` object is created by the `Module` system. Sometimes this is
                 * not acceptable; many want their module to be an instance of some class. To do
                 * this, assign the desired export object to `module.exports`.
                 * @since v0.1.16
                 */
                exports: any;
                /**
                 * The fully resolved filename of the module.
                 * @since v0.1.16
                 */
                filename: string;
                /**
                 * The identifier for the module. Typically this is the fully resolved
                 * filename.
                 * @since v0.1.16
                 */
                id: string;
                /**
                 * `true` if the module is running during the Node.js preload
                 * phase.
                 * @since v15.4.0, v14.17.0
                 */
                isPreloading: boolean;
                /**
                 * Whether or not the module is done loading, or is in the process of
                 * loading.
                 * @since v0.1.16
                 */
                loaded: boolean;
                /**
                 * The module that first required this one, or `null` if the current module is the
                 * entry point of the current process, or `undefined` if the module was loaded by
                 * something that is not a CommonJS module (e.g. REPL or `import`).
                 * @since v0.1.16
                 * @deprecated Please use `require.main` and `module.children` instead.
                 */
                parent: Module | null | undefined;
                /**
                 * The directory name of the module. This is usually the same as the
                 * `path.dirname()` of the `module.id`.
                 * @since v11.14.0
                 */
                path: string;
                /**
                 * The search paths for the module.
                 * @since v0.4.0
                 */
                paths: string[];
                /**
                 * The `module.require()` method provides a way to load a module as if
                 * `require()` was called from the original module.
                 * @since v0.5.1
                 */
                require(id: string): any;
            }
            interface Require {
                /**
                 * Used to import modules, `JSON`, and local files.
                 * @since v0.1.13
                 */
                (id: string): any;
                /**
                 * Modules are cached in this object when they are required. By deleting a key
                 * value from this object, the next `require` will reload the module.
                 * This does not apply to
                 * [native addons](https://nodejs.org/docs/latest-v20.x/api/addons.html),
                 * for which reloading will result in an error.
                 * @since v0.3.0
                 */
                cache: Dict<Module>;
                /**
                 * Instruct `require` on how to handle certain file extensions.
                 * @since v0.3.0
                 * @deprecated
                 */
                extensions: RequireExtensions;
                /**
                 * The `Module` object representing the entry script loaded when the Node.js
                 * process launched, or `undefined` if the entry point of the program is not a
                 * CommonJS module.
                 * @since v0.1.17
                 */
                main: Module | undefined;
                /**
                 * @since v0.3.0
                 */
                resolve: RequireResolve;
            }
            /** @deprecated */
            interface RequireExtensions extends Dict<(module: Module, filename: string) => any> {
                ".js": (module: Module, filename: string) => any;
                ".json": (module: Module, filename: string) => any;
                ".node": (module: Module, filename: string) => any;
            }
            interface RequireResolveOptions {
                /**
                 * Paths to resolve module location from. If present, these
                 * paths are used instead of the default resolution paths, with the exception
                 * of
                 * [GLOBAL\_FOLDERS](https://nodejs.org/docs/latest-v20.x/api/modules.html#loading-from-the-global-folders)
                 * like `$HOME/.node_modules`, which are
                 * always included. Each of these paths is used as a starting point for
                 * the module resolution algorithm, meaning that the `node_modules` hierarchy
                 * is checked from this location.
                 * @since v8.9.0
                 */
                paths?: string[] | undefined;
            }
            interface RequireResolve {
                /**
                 * Use the internal `require()` machinery to look up the location of a module,
                 * but rather than loading the module, just return the resolved filename.
                 *
                 * If the module can not be found, a `MODULE_NOT_FOUND` error is thrown.
                 * @since v0.3.0
                 * @param request The module path to resolve.
                 */
                (id: string, options?: RequireResolveOptions): string;
                /**
                 * Returns an array containing the paths searched during resolution of `request` or
                 * `null` if the `request` string references a core module, for example `http` or
                 * `fs`.
                 * @since v8.9.0
                 * @param request The module path whose lookup paths are being retrieved.
                 */
                paths(request: string): string[] | null;
            }
        }
        /**
         * The directory name of the current module. This is the same as the
         * `path.dirname()` of the `__filename`.
         * @since v0.1.27
         */
        var __dirname: string;
        /**
         * The file name of the current module. This is the current module file's absolute
         * path with symlinks resolved.
         *
         * For a main program this is not necessarily the same as the file name used in the
         * command line.
         * @since v0.0.1
         */
        var __filename: string;
        /**
         * The `exports` variable is available within a module's file-level scope, and is
         * assigned the value of `module.exports` before the module is evaluated.
         * @since v0.1.16
         */
        var exports: NodeJS.Module["exports"];
        /**
         * A reference to the current module.
         * @since v0.1.16
         */
        var module: NodeJS.Module;
        /**
         * @since v0.1.13
         */
        var require: NodeJS.Require;
        // Global-scope aliases for backwards compatibility with @types/node <13.0.x
        /** @deprecated Use `NodeJS.Module` instead. */
        interface NodeModule extends NodeJS.Module {}
        /** @deprecated Use `NodeJS.Require` instead. */
        interface NodeRequire extends NodeJS.Require {}
        /** @deprecated Use `NodeJS.RequireResolve` instead. */
        interface RequireResolve extends NodeJS.RequireResolve {}
    }
    export = Module;
}
declare module "node:module" {
    import module = require("module");
    export = module;
}
