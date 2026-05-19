/**
 * An opaque reference allows hiding values from the serializer.
 */
export declare class OpaqueReference<V, R = undefined> {
    readonly value: V;
    readonly replacement?: R | undefined;
    constructor(value: V, replacement?: R | undefined);
}
//# sourceMappingURL=opaque-reference.d.ts.map