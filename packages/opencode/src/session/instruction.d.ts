import type { MessageV2 } from "./message-v2";
export declare namespace InstructionPrompt {
    function clear(messageID: string): void;
    function systemPaths(): Promise<Set<string>>;
    function system(): Promise<string[]>;
    function loaded(messages: MessageV2.WithParts[]): Set<string>;
    function find(dir: string): Promise<string | undefined>;
    function resolve(messages: MessageV2.WithParts[], filepath: string, messageID: string): Promise<{
        filepath: string;
        content: string;
    }[]>;
}
