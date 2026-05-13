import { Project } from "./project";
type Info = Project.Info;
interface Ctx {
    project: Info;
}
/** Bootstrap from a filesystem path: use `workspace` (preferred) or `directory` (same meaning). */
type ProvideGetInput = {
    project: Info;
    init?: () => Promise<any>;
} | {
    workspace: string;
    init?: () => Promise<any>;
} | {
    directory: string;
    init?: () => Promise<any>;
};
export declare const Instance: {
    provide<R>(input: ProvideGetInput & {
        fn: () => R;
    }): Promise<R>;
    get(input: ProvideGetInput): Promise<Ctx>;
    readonly project: {
        [x: string]: any;
        name?: string | undefined;
        icon?: {
            url?: string | undefined;
            override?: string | undefined;
            color?: string | undefined;
        } | undefined;
        commands?: {
            start?: string | undefined;
        } | undefined;
        time: {
            created: number;
            updated: number;
            initialized?: number | undefined;
        };
        vcs?: "git" | undefined;
    };
    readonly projectID: any;
    readonly workspace: string;
    containsPath(candidate: string): boolean;
    state<S>(init: () => S, dispose?: ((state: Awaited<S>) => Promise<void>) | undefined): () => S;
    reload(input: {
        project: {
            [x: string]: any;
            name?: string | undefined;
            icon?: {
                url?: string | undefined;
                override?: string | undefined;
                color?: string | undefined;
            } | undefined;
            commands?: {
                start?: string | undefined;
            } | undefined;
            time: {
                created: number;
                updated: number;
                initialized?: number | undefined;
            };
            vcs?: "git" | undefined;
        };
        init?: (() => Promise<any>) | undefined;
    }): Promise<Ctx>;
    dispose(): Promise<void>;
    disposeAll(): Promise<void>;
};
export {};
