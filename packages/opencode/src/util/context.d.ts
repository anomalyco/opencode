export declare namespace Context {
    class NotFound extends Error {
        readonly name: string;
        constructor(name: string);
    }
    function create<T>(name: string): {
        use(): NonNullable<T>;
        provide<R>(value: T, fn: () => R): R;
    };
}
