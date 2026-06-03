export declare const SCOPE_PRIORITY: Record<string, number>;
export declare function sortByScopePriority<TItem extends {
    scope: string;
}>(items: TItem[]): TItem[];
