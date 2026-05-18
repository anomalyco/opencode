import type { PrimitiveType, PointyObject, ObjectPointerDef, AllocStructOptions, AllocStructResult, EnumDef, StructDef, StructDefOptions, DefineStructReturnType } from "./types";
export declare const pointerSize: number;
/**
 * Type helper for creating object pointers for structs.
 */
export declare function objectPtr<T extends PointyObject>(): ObjectPointerDef<T>;
export declare function allocStruct(structDef: StructDef<any, any>, options?: AllocStructOptions): AllocStructResult;
export declare function defineEnum<T extends Record<string, number>>(mapping: T, base?: Exclude<PrimitiveType, "bool_u8" | "bool_u32">): EnumDef<T>;
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
export declare function packObjectArray(val: (PointyObject | null)[]): DataView<ArrayBuffer>;
export declare function defineStruct<const Fields extends readonly StructField[], const Opts extends StructDefOptions = {}>(fields: Fields & StructField[], structDefOptions?: Opts): DefineStructReturnType<Fields, Opts>;
export {};
