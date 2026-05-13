export declare namespace Discovery {
    function dir(): string;
    function pull(url: string): Promise<string[]>;
}
