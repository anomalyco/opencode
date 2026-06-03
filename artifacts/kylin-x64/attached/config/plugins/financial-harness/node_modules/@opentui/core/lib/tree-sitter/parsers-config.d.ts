/**
 * This file contains the configuration for the defaulttree-sitter parsers.
 * It is used by ./assets/update.ts to generate the default-parsers.ts file.
 * For changes here to be reflected in the default-parsers.ts file, you need to run `bun run ./assets/update.ts`
 */
declare const _default: {
    parsers: ({
        filetype: string;
        aliases: string[];
        wasm: string;
        queries: {
            highlights: string[];
            injections?: undefined;
        };
        injectionMapping?: undefined;
    } | {
        filetype: string;
        wasm: string;
        queries: {
            highlights: string[];
            injections: string[];
        };
        injectionMapping: {
            nodeTypes: {
                inline: string;
                pipe_table_cell: string;
            };
            infoStringMap: {
                javascript: string;
                js: string;
                jsx: string;
                javascriptreact: string;
                typescript: string;
                ts: string;
                tsx: string;
                typescriptreact: string;
                markdown: string;
                md: string;
            };
        };
        aliases?: undefined;
    } | {
        filetype: string;
        wasm: string;
        queries: {
            highlights: string[];
            injections?: undefined;
        };
        aliases?: undefined;
        injectionMapping?: undefined;
    })[];
};
export default _default;
