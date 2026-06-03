import { LSPClientConnection } from "./lsp-client-connection";
import type { Diagnostic } from "./types";
export declare class LSPClient extends LSPClientConnection {
    private openedFiles;
    private documentVersions;
    private lastSyncedText;
    openFile(filePath: string): Promise<void>;
    definition(filePath: string, line: number, character: number): Promise<unknown>;
    references(filePath: string, line: number, character: number, includeDeclaration?: boolean): Promise<unknown>;
    documentSymbols(filePath: string): Promise<unknown>;
    workspaceSymbols(query: string): Promise<unknown>;
    diagnostics(filePath: string): Promise<{
        items: Diagnostic[];
    }>;
    prepareRename(filePath: string, line: number, character: number): Promise<unknown>;
    rename(filePath: string, line: number, character: number, newName: string): Promise<unknown>;
}
