import { TreeSitterClient } from "./client.js";
export * from "./client.js";
export * from "../tree-sitter-styled-text.js";
export * from "./types.js";
export * from "./resolve-ft.js";
export declare function getTreeSitterClient(): TreeSitterClient;
export declare function destroyTreeSitterClient(): Promise<void>;
