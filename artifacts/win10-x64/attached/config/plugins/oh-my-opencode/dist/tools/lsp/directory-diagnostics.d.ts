export declare function aggregateDiagnosticsForDirectory(directory: string, extension: string, severity?: "error" | "warning" | "information" | "hint" | "all", maxFiles?: number): Promise<string>;
