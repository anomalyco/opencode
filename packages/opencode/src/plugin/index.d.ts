import type { Hooks } from "@opencode-ai/plugin";
export declare namespace Plugin {
    function trigger<Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">, Input = Parameters<Required<Hooks>[Name]>[0], Output = Parameters<Required<Hooks>[Name]>[1]>(name: Name, input: Input, output: Output): Promise<Output>;
    function list(): Promise<Hooks[]>;
    function init(): Promise<void>;
}
