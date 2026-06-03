export interface LSPServerConfig {
    id: string;
    command: string[];
    extensions: string[];
    disabled?: boolean;
    env?: Record<string, string>;
    initialization?: Record<string, unknown>;
}
export interface Position {
    line: number;
    character: number;
}
export interface Range {
    start: Position;
    end: Position;
}
export interface Location {
    uri: string;
    range: Range;
}
export interface LocationLink {
    targetUri: string;
    targetRange: Range;
    targetSelectionRange: Range;
    originSelectionRange?: Range;
}
export interface SymbolInfo {
    name: string;
    kind: number;
    location: Location;
    containerName?: string;
}
export interface DocumentSymbol {
    name: string;
    kind: number;
    range: Range;
    selectionRange: Range;
    children?: DocumentSymbol[];
}
export interface Diagnostic {
    range: Range;
    severity?: number;
    code?: string | number;
    source?: string;
    message: string;
}
export interface TextDocumentIdentifier {
    uri: string;
}
export interface VersionedTextDocumentIdentifier extends TextDocumentIdentifier {
    version: number | null;
}
export interface TextEdit {
    range: Range;
    newText: string;
}
export interface TextDocumentEdit {
    textDocument: VersionedTextDocumentIdentifier;
    edits: TextEdit[];
}
export interface CreateFile {
    kind: "create";
    uri: string;
    options?: {
        overwrite?: boolean;
        ignoreIfExists?: boolean;
    };
}
export interface RenameFile {
    kind: "rename";
    oldUri: string;
    newUri: string;
    options?: {
        overwrite?: boolean;
        ignoreIfExists?: boolean;
    };
}
export interface DeleteFile {
    kind: "delete";
    uri: string;
    options?: {
        recursive?: boolean;
        ignoreIfNotExists?: boolean;
    };
}
export interface WorkspaceEdit {
    changes?: {
        [uri: string]: TextEdit[];
    };
    documentChanges?: (TextDocumentEdit | CreateFile | RenameFile | DeleteFile)[];
}
export interface PrepareRenameResult {
    range: Range;
    placeholder?: string;
}
export interface PrepareRenameDefaultBehavior {
    defaultBehavior: boolean;
}
export interface ServerLookupInfo {
    id: string;
    command: string[];
    extensions: string[];
}
export type ServerLookupResult = {
    status: "found";
    server: ResolvedServer;
} | {
    status: "not_configured";
    extension: string;
    availableServers: string[];
} | {
    status: "not_installed";
    server: ServerLookupInfo;
    installHint: string;
};
export interface ResolvedServer {
    id: string;
    command: string[];
    extensions: string[];
    priority: number;
    env?: Record<string, string>;
    initialization?: Record<string, unknown>;
}
