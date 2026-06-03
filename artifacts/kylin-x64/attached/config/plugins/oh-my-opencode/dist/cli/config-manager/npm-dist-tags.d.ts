export interface NpmDistTags {
    latest?: string;
    beta?: string;
    next?: string;
    [tag: string]: string | undefined;
}
export declare function fetchNpmDistTags(packageName: string): Promise<NpmDistTags | null>;
