export declare function camelToSnake(str: string): string;
export declare function snakeToCamel(str: string): string;
export declare function transformObjectKeys(obj: Record<string, unknown>, transformer: (key: string) => string, deep?: boolean): Record<string, unknown>;
export declare function objectToSnakeCase(obj: Record<string, unknown>, deep?: boolean): Record<string, unknown>;
export declare function objectToCamelCase(obj: Record<string, unknown>, deep?: boolean): Record<string, unknown>;
