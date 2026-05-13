export declare function parseVariantFromModelID(rawModelID: string): {
    modelID: string;
    variant?: string;
};
export declare function parseModelString(model: string): {
    providerID: string;
    modelID: string;
    variant?: string;
} | undefined;
