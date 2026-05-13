export declare namespace Env {
    function get(key: string): string | undefined;
    function all(): Record<string, string | undefined>;
    function set(key: string, value: string): void;
    function remove(key: string): void;
}
