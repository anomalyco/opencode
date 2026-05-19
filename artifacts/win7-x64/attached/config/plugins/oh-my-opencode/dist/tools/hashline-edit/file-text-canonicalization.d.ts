export interface FileTextEnvelope {
    content: string;
    hadBom: boolean;
    lineEnding: "\n" | "\r\n";
}
export declare function canonicalizeFileText(content: string): FileTextEnvelope;
export declare function restoreFileText(content: string, envelope: FileTextEnvelope): string;
