export declare namespace Lock {
    function read(key: string): Promise<Disposable>;
    function write(key: string): Promise<Disposable>;
}
