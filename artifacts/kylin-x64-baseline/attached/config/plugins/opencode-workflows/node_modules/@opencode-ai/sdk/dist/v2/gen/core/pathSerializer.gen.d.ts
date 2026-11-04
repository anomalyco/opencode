interface SerializeOptions<T> extends SerializePrimitiveOptions, SerializerOptions<T> {
}
interface SerializePrimitiveOptions {
    allowReserved?: boolean;
    name: string;
}
export interface SerializerOptions<T> {
    /**
     * @default true
     */
    explode: boolean;
    style: T;
}
export type ArrayStyle = "form" | "spaceDelimited" | "pipeDelimited";
export type ArraySeparatorStyle = ArrayStyle | MatrixStyle;
type MatrixStyle = "label" | "matrix" | "simple";
export type ObjectStyle = "form" | "deepObject";
type ObjectSeparatorStyle = ObjectStyle | MatrixStyle;
interface SerializePrimitiveParam extends SerializePrimitiveOptions {
    value: string;
}
export declare const separatorArrayExplode: (style: ArraySeparatorStyle) => "." | ";" | "," | "&";
export declare const separatorArrayNoExplode: (style: ArraySeparatorStyle) => "," | "|" | "%20";
export declare const separatorObjectExplode: (style: ObjectSeparatorStyle) => "." | ";" | "," | "&";
export declare const serializeArrayParam: ({ allowReserved, explode, name, style, value, }: SerializeOptions<ArraySeparatorStyle> & {
    value: unknown[];
}) => string;
export declare const serializePrimitiveParam: ({ allowReserved, name, value }: SerializePrimitiveParam) => string;
export declare const serializeObjectParam: ({ allowReserved, explode, name, style, value, valueOnly, }: SerializeOptions<ObjectSeparatorStyle> & {
    value: Record<string, unknown> | Date;
    valueOnly?: boolean;
}) => string;
export {};
