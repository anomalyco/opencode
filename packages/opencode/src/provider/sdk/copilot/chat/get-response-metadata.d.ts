export declare function getResponseMetadata({ id, model, created }: {
    id?: string | undefined | null;
    created?: number | undefined | null;
    model?: string | undefined | null;
}): {
    id: string | undefined;
    modelId: string | undefined;
    timestamp: Date | undefined;
};
