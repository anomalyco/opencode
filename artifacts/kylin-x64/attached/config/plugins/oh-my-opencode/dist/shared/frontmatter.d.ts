export interface FrontmatterResult<T = Record<string, unknown>> {
    data: T;
    body: string;
    hadFrontmatter: boolean;
    parseError: boolean;
}
export declare function parseFrontmatter<T = Record<string, unknown>>(content: string): FrontmatterResult<T>;
