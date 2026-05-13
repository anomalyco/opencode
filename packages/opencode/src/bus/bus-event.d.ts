import z from "zod";
import type { ZodType } from "zod";
export declare namespace BusEvent {
    type Definition = ReturnType<typeof define>;
    function define<Type extends string, Properties extends ZodType>(type: Type, properties: Properties): {
        type: Type;
        properties: Properties;
    };
    function payloads(): z.ZodDiscriminatedUnion<any, "type">;
}
