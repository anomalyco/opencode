interface FormatterConfig {
    disabled?: boolean;
    command?: string[];
    environment?: Record<string, string>;
    extensions?: string[];
}
interface OpencodeConfig {
    formatter?: false | Record<string, FormatterConfig>;
    experimental?: {
        hook?: {
            file_edited?: Record<string, Array<{
                command: string[];
                environment?: Record<string, string>;
            }>>;
        };
    };
}
export interface FormatterClient {
    config: {
        get: (options?: {
            query?: {
                directory?: string;
            };
        }) => Promise<{
            data?: OpencodeConfig;
        }>;
    };
}
type FormatterDefinition = {
    command: string[];
    environment: Record<string, string>;
};
type FormatterMap = Map<string, FormatterDefinition[]>;
export declare function resolveFormatters(client: FormatterClient, directory: string): Promise<FormatterMap>;
export declare function buildFormatterCommand(command: string[], filePath: string): string[];
export declare function runFormattersForFile(client: FormatterClient, directory: string, filePath: string): Promise<void>;
export declare function clearFormatterCache(): void;
export {};
