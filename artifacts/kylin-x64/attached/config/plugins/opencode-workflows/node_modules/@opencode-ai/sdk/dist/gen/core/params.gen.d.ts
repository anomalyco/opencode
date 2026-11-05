type Slot = "body" | "headers" | "path" | "query";
export type Field = {
    in: Exclude<Slot, "body">;
    /**
     * Field name. This is the name we want the user to see and use.
     */
    key: string;
    /**
     * Field mapped name. This is the name we want to use in the request.
     * If omitted, we use the same value as `key`.
     */
    map?: string;
} | {
    in: Extract<Slot, "body">;
    /**
     * Key isn't required for bodies.
     */
    key?: string;
    map?: string;
};
export interface Fields {
    allowExtra?: Partial<Record<Slot, boolean>>;
    args?: ReadonlyArray<Field>;
}
export type FieldsConfig = ReadonlyArray<Field | Fields>;
interface Params {
    body: unknown;
    headers: Record<string, unknown>;
    path: Record<string, unknown>;
    query: Record<string, unknown>;
}
export declare const buildClientParams: (args: ReadonlyArray<unknown>, fields: FieldsConfig) => Params;
export {};
