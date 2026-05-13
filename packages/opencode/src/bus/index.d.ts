import z from "zod";
import { BusEvent } from "./bus-event";
export declare namespace Bus {
    const InstanceDisposed: {
        type: "server.instance.disposed";
        properties: z.ZodObject<{
            projectID: any;
        }, z.core.$strip>;
    };
    function publish<Definition extends BusEvent.Definition>(def: Definition, properties: z.output<Definition["properties"]>): Promise<void[]>;
    function subscribe<Definition extends BusEvent.Definition>(def: Definition, callback: (event: {
        type: Definition["type"];
        properties: z.infer<Definition["properties"]>;
    }) => void): () => void;
    function once<Definition extends BusEvent.Definition>(def: Definition, callback: (event: {
        type: Definition["type"];
        properties: z.infer<Definition["properties"]>;
    }) => "done" | undefined): void;
    function subscribeAll(callback: (event: any) => void): () => void;
}
