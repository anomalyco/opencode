import z from "zod";
import { Tool } from "./tool";
export declare const LspTool: Tool.Info<z.ZodObject<{
    operation: z.ZodEnum<{
        documentSymbol: "documentSymbol";
        findReferences: "findReferences";
        goToDefinition: "goToDefinition";
        goToImplementation: "goToImplementation";
        hover: "hover";
        incomingCalls: "incomingCalls";
        outgoingCalls: "outgoingCalls";
        prepareCallHierarchy: "prepareCallHierarchy";
        workspaceSymbol: "workspaceSymbol";
    }>;
    filePath: z.ZodString;
    line: z.ZodNumber;
    character: z.ZodNumber;
}, z.core.$strip>, {
    result: unknown[];
}>;
