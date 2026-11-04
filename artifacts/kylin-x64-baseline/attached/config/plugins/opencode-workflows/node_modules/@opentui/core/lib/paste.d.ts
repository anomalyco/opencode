export type PasteKind = "text" | "binary" | "unknown";
export interface PasteMetadata {
    mimeType?: string;
    kind?: PasteKind;
}
export declare function decodePasteBytes(bytes: Uint8Array): string;
export declare function stripAnsiSequences(text: string): string;
