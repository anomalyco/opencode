type ModelDescriptor = {
    providerID: string;
    modelID: string;
};
export declare function resolveValidUltraworkVariant(client: unknown, model: ModelDescriptor | undefined, variant: string | undefined): Promise<string | undefined>;
export {};
