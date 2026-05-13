import { type ChildProcessWithoutNullStreams } from "child_process";
export declare namespace LSPServer {
    export interface Handle {
        process: ChildProcessWithoutNullStreams;
        initialization?: Record<string, any>;
    }
    type RootFunction = (file: string) => Promise<string | undefined>;
    export interface Info {
        id: string;
        extensions: string[];
        global?: boolean;
        root: RootFunction;
        spawn(root: string): Promise<Handle | undefined>;
    }
    export const Deno: Info;
    export const Typescript: Info;
    export const Vue: Info;
    export const ESLint: Info;
    export const Oxlint: Info;
    export const Biome: Info;
    export const Gopls: Info;
    export const Rubocop: Info;
    export const Ty: Info;
    export const Pyright: Info;
    export const ElixirLS: Info;
    export const Zls: Info;
    export const CSharp: Info;
    export const FSharp: Info;
    export const SourceKit: Info;
    export const RustAnalyzer: Info;
    export const Clangd: Info;
    export const Svelte: Info;
    export const Astro: Info;
    export const JDTLS: Info;
    export const KotlinLS: Info;
    export const YamlLS: Info;
    export const LuaLS: Info;
    export const PHPIntelephense: Info;
    export const Prisma: Info;
    export const Dart: Info;
    export const Ocaml: Info;
    export const BashLS: Info;
    export const TerraformLS: Info;
    export const TexLab: Info;
    export const DockerfileLS: Info;
    export const Gleam: Info;
    export const Clojure: Info;
    export const Nixd: Info;
    export const Tinymist: Info;
    export const HLS: Info;
    export const JuliaLS: Info;
    export {};
}
