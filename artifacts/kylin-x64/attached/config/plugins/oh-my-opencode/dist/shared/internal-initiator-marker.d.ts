export declare const OMO_INTERNAL_INITIATOR_MARKER = "<!-- OMO_INTERNAL_INITIATOR -->";
export declare function stripInternalInitiatorMarkers(text: string): string;
export declare function createInternalAgentTextPart(text: string): {
    type: "text";
    text: string;
};
