type MockModuleFactory = () => Record<string, unknown>;
type MockApi = {
    module: (specifier: string, factory: MockModuleFactory) => unknown;
    restore: () => unknown;
};
type ModuleLoadResult = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: Error;
};
type ModuleMockLifecycleOptions = {
    getCallerUrl?: () => string;
    resolveSpecifier?: (specifier: string, callerUrl: string) => string;
    loadOriginalModule?: (specifier: string, callerUrl: string) => ModuleLoadResult;
};
export declare function installModuleMockLifecycle(mockApi: MockApi, options?: ModuleMockLifecycleOptions): {
    restoreModuleMocks: () => void;
};
export {};
