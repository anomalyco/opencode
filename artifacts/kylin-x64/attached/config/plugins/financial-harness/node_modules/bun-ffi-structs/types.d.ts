import type { Pointer } from "bun:ffi";
export type PrimitiveType = "u8" | "u16" | "u32" | "u64" | "f32" | "f64" | "pointer" | "i32" | "i16" | "bool_u8" | "bool_u32";
export interface PointyObject {
    ptr: Pointer | number | bigint | null;
}
export interface ObjectPointerDef<T extends PointyObject> {
    __type: "objectPointer";
}
type Prettify<T> = {
    [K in keyof T]: T[K];
} & {};
export type Simplify<T> = T extends (...args: any[]) => any ? T : T extends object ? Prettify<T> : T;
export type PrimitiveToTSType<T extends PrimitiveType> = T extends "u8" | "u16" | "u32" | "i16" | "i32" | "f32" | "f64" ? number : T extends "u64" ? bigint | number : T extends "bool_u8" | "bool_u32" ? boolean : T extends "pointer" ? number | bigint : never;
type FieldDefInputType<Def, Options = undefined> = Options extends {
    packTransform: (value: infer T) => any;
} ? T : Def extends PrimitiveType ? PrimitiveToTSType<Def> : Def extends "cstring" | "char*" ? string | null : Def extends EnumDef<infer E> ? keyof E : Def extends StructDef<any, infer InputType> ? InputType : Def extends ObjectPointerDef<infer T> ? T | null : Def extends readonly [infer InnerDef] ? InnerDef extends PrimitiveType ? Iterable<PrimitiveToTSType<InnerDef>> : InnerDef extends EnumDef<infer E> ? Iterable<keyof E> : InnerDef extends StructDef<any, infer InputType> ? Iterable<InputType> : InnerDef extends ObjectPointerDef<infer T> ? (T | null)[] : never : never;
type HasLengthOfField<Fields extends readonly StructField[], FieldName> = Fields extends readonly [
    infer First,
    ...infer Rest extends readonly StructField[]
] ? First extends readonly [string, any, {
    lengthOf: FieldName;
}] ? true : HasLengthOfField<Rest, FieldName> : false;
type FieldDefOutputType<Def, Options = undefined, FieldName = never, AllFields extends readonly StructField[] = []> = Options extends {
    unpackTransform: (value: any) => infer T;
} ? T : Def extends PrimitiveType ? PrimitiveToTSType<Def> : Def extends "cstring" ? string | null : Def extends "char*" ? HasLengthOfField<AllFields, FieldName> extends true ? string | null : number : Def extends EnumDef<infer E> ? keyof E : Def extends StructDef<infer OutputType, any> ? OutputType : Def extends ObjectPointerDef<infer T> ? T | null : Def extends readonly [infer InnerDef] ? InnerDef extends PrimitiveType ? Iterable<PrimitiveToTSType<InnerDef>> : InnerDef extends EnumDef<infer E> ? Iterable<keyof E> : InnerDef extends StructDef<infer OutputType, any> ? Iterable<OutputType> : InnerDef extends ObjectPointerDef<infer T> ? (T | null)[] : never : never;
type IsOptional<Options extends StructFieldOptions | undefined> = Options extends {
    optional: true;
} ? true : Options extends {
    default: any;
} ? true : Options extends {
    lengthOf: string;
} ? true : Options extends {
    condition: () => boolean;
} ? true : false;
export type StructObjectInputType<Fields extends readonly StructField[]> = {
    [F in Fields[number] as IsOptional<F[2]> extends false ? F[0] : never]: FieldDefInputType<F[1], F[2]>;
} & {
    [F in Fields[number] as IsOptional<F[2]> extends true ? F[0] : never]?: FieldDefInputType<F[1], F[2]> | null;
};
export type StructObjectOutputType<Fields extends readonly StructField[]> = {
    [F in Fields[number] as IsOptional<F[2]> extends false ? F[0] : never]: FieldDefOutputType<F[1], F[2], F[0], Fields>;
} & {
    [F in Fields[number] as IsOptional<F[2]> extends true ? F[0] : never]?: FieldDefOutputType<F[1], F[2], F[0], Fields> | null;
};
export type DefineStructReturnType<Fields extends readonly StructField[], Options extends StructDefOptions | undefined> = StructDef<Simplify<Options extends {
    reduceValue: (value: any) => infer R;
} ? R : StructObjectOutputType<Fields>>, Simplify<Options extends {
    mapValue: (value: infer V) => any;
} ? V : StructObjectInputType<Fields>>>;
export interface AllocStructOptions {
    lengths?: Record<string, number>;
}
export interface AllocStructResult {
    buffer: ArrayBuffer;
    view: DataView;
    subBuffers?: Record<string, ArrayBuffer>;
}
export interface EnumDef<T extends Record<string, number>> {
    __type: "enum";
    type: Exclude<PrimitiveType, "bool_u8" | "bool_u32">;
    to(value: keyof T): number;
    from(value: number | bigint): keyof T;
    enum: T;
}
type ValidationFunction = (value: any, fieldName: string, options: {
    hints?: any;
    input?: any;
}) => void | never;
interface StructFieldOptions {
    optional?: boolean;
    mapOptionalInline?: boolean;
    unpackTransform?: (value: any) => any;
    packTransform?: (value: any) => any;
    lengthOf?: string;
    asPointer?: boolean;
    default?: any;
    condition?: () => boolean;
    validate?: ValidationFunction | ValidationFunction[];
}
type StructField = readonly [string, PrimitiveType, StructFieldOptions?] | readonly [string, EnumDef<any>, StructFieldOptions?] | readonly [string, StructDef<any>, StructFieldOptions?] | readonly [string, "cstring" | "char*", StructFieldOptions?] | readonly [string, ObjectPointerDef<any>, StructFieldOptions?] | readonly [
    string,
    readonly [EnumDef<any> | StructDef<any> | PrimitiveType | ObjectPointerDef<any>],
    StructFieldOptions?
];
export interface StructFieldPackOptions {
    validationHints?: any;
}
export interface StructFieldDescription {
    name: string;
    offset: number;
    size: number;
    align: number;
    optional: boolean;
    type: PrimitiveType | EnumDef<any> | StructDef<any> | "cstring" | "char*" | ObjectPointerDef<any> | readonly [any];
    lengthOf?: string;
}
export interface ArrayFieldMetadata {
    elementSize: number;
    arrayOffset: number;
    lengthOffset: number;
    lengthPack: (view: DataView, offset: number, value: number) => void;
}
export interface StructDef<OutputType, InputType = OutputType> {
    __type: "struct";
    size: number;
    align: number;
    hasMapValue: boolean;
    layoutByName: Map<string, StructFieldDescription>;
    arrayFields: Map<string, ArrayFieldMetadata>;
    pack(obj: Simplify<InputType>, options?: StructFieldPackOptions): ArrayBuffer;
    packInto(obj: Simplify<InputType>, view: DataView, offset: number, options?: StructFieldPackOptions): void;
    packList(objects: Simplify<InputType>[], options?: StructFieldPackOptions): ArrayBuffer;
    unpack(buf: ArrayBuffer | SharedArrayBuffer): Simplify<OutputType>;
    unpackList(buf: ArrayBuffer | SharedArrayBuffer, count: number): Simplify<OutputType>[];
    describe(): StructFieldDescription[];
}
export interface StructDefOptions {
    default?: Record<string, any>;
    mapValue?: (value: any) => any;
    reduceValue?: (value: any) => any;
}
export {};
