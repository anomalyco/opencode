import type { BuiltinCommandName, BuiltinCommands } from "./types";
interface LoadBuiltinCommandsOptions {
    useRegisteredAgents?: boolean;
}
export declare function loadBuiltinCommands(disabledCommands?: BuiltinCommandName[], options?: LoadBuiltinCommandsOptions): BuiltinCommands;
export {};
