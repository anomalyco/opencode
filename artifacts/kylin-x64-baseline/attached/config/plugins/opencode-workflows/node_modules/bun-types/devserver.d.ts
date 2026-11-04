declare module "bun" {
  type HMREventNames =
    | "beforeUpdate"
    | "afterUpdate"
    | "beforeFullReload"
    | "beforePrune"
    | "invalidate"
    | "error"
    | "ws:disconnect"
    | "ws:connect";

  /**
   * The event names for the dev server
   */
  type HMREvent = `bun:${HMREventNames}` | (string & {});
}

interface ImportMeta {
  /**
   * Hot module replacement APIs. This value is `undefined` in production and
   * can be used in an `if` statement to check if HMR APIs are available
   *
   * ```ts
   * if (import.meta.hot) {
   *   // HMR APIs are available
   * }
   * ```
   *
   * However, this check is usually not needed as Bun will dead-code-eliminate
   * calls to all of the HMR APIs in production builds.
   *
   * https://bun.com/docs/bundler/hmr
   */
  hot: {
    /**
     * `import.meta.hot.data` maintains state between module instances during
     * hot replacement, enabling data transfer from previous to new versions.
     * When `import.meta.hot.data` is written to, Bun will mark this module as
     * capable of self-accepting (equivalent of calling `accept()`).
     *
     * @example
     * ```ts
     * const root = import.meta.hot.data.root ??= createRoot(elem);
     * root.render(<App />); // re-use an existing root
     * ```
     *
     * In production, `data` is inlined to be `{}`. This is handy because Bun
     * knows it can minify `{}.prop ??= value` into `value` in production.
     */
    data: any;

    /**
     * Indicate that this module can be replaced simply by re-evaluating the
     * file. After a hot update, importers of this module will be
     * automatically patched.
     *
     * When `import.meta.hot.accept` is not used, the page will reload when
     * the file updates, and a console message shows which files were checked.
     *
     * @example
     * ```ts
     * import { getCount } from "./foo";
     *
     * console.log("count is ", getCount());
     *
     * import.meta.hot.accept();
     * ```
     */
    accept(): void;

    /**
     * Indicate that this module can be replaced by evaluating the new module,
     * and then calling the callback with the new module. In this mode, the
     * importers do not get patched. This is to match Vite, which is unable
     * to patch their import statements. Prefer using `import.meta.hot.accept()`
     * without an argument as it usually makes your code easier to understand.
     *
     * When `import.meta.hot.accept` is not used, the page will reload when
     * the file updates, and a console message shows which files were checked.
     *
     * @example
     * ```ts
     * export const count = 0;
     *
     * import.meta.hot.accept((newModule) => {
     *   if (newModule) {
     *     // newModule is undefined when SyntaxError happened
     *     console.log('updated: count is now ', newModule.count)
     *   }
     * });
     * ```
     *
     * In production, calls to this are dead-code-eliminated.
     */
    accept(cb: (newModule: any | undefined) => void): void;

    /**
     * Indicate that a dependency's module can be accepted. When the dependency
     * is updated, the callback will be called with the new module.
     *
     * When `import.meta.hot.accept` is not used, the page will reload when
     * the file updates, and a console message shows which files were checked.
     *
     * @example
     * ```ts
     * import.meta.hot.accept('./foo', (newModule) => {
     *   if (newModule) {
     *     // newModule is undefined when SyntaxError happened
     *     console.log('updated: count is now ', newModule.count)
     *   }
     * });
     * ```
     */
    accept(specifier: string, callback: (newModule: any) => void): void;

    /**
     * Indicate that a dependency's module can be accepted. This variant
     * accepts an array of dependencies, where the callback will receive
     * the one updated module, and `undefined` for the rest.
     *
     * When `import.meta.hot.accept` is not used, the page will reload when
     * the file updates, and a console message shows which files were checked.
     */
    accept(specifiers: string[], callback: (newModules: (any | undefined)[]) => void): void;

    /**
     * Attach an on-dispose callback. This is called:
     * - Just before the module is replaced with another copy (before the next is loaded)
     * - After the module is detached (removing all imports to this module)
     *
     * This callback is not called on route navigation or when the browser tab closes.
     *
     * Returning a promise will delay module replacement until the module is
     * disposed. All dispose callbacks are called in parallel.
     */
    dispose(cb: (data: any) => void | Promise<void>): void;

    /**
     * No-op
     * @deprecated
     */
    decline(): void;

    // NOTE TO CONTRIBUTORS ////////////////////////////////////////
    //     Callback is currently never called for `.prune()`      //
    //     so the types are commented out until we support it.    //
    ////////////////////////////////////////////////////////////////
    // /**
    //  * Attach a callback that is called when the module is removed from the module graph.
    //  *
    //  * This can be used to clean up resources that were created when the module was loaded.
    //  * Unlike `import.meta.hot.dispose()`, this pairs much better with `accept` and `data` to manage stateful resources.
    //  *
    //  * @example
    //  * ```ts
    //  * export const ws = (import.meta.hot.data.ws ??= new WebSocket(location.origin));
    //  *
    //  * import.meta.hot.prune(() => {
    //  *   ws.close();
    //  * });
    //  * ```
    //  */
    // prune(callback: () => void): void;

    /**
     * Listen for an event from the dev server
     *
     * For compatibility with Vite, event names are also available via vite:* prefix instead of bun:*.
     *
     * https://bun.com/docs/bundler/hmr#import-meta-hot-on-and-off
     * @param event The event to listen to
     * @param callback The callback to call when the event is emitted
     */
    on(event: Bun.HMREvent, callback: () => void): void;

    /**
     * Stop listening for an event from the dev server
     *
     * For compatibility with Vite, event names are also available via vite:* prefix instead of bun:*.
     *
     * https://bun.com/docs/bundler/hmr#import-meta-hot-on-and-off
     * @param event The event to stop listening to
     * @param callback The callback to stop listening to
     */
    off(event: Bun.HMREvent, callback: () => void): void;
  };
}
