import { EventEmitter } from "events";
export declare const GlobalBus: EventEmitter<{
    event: [{
        projectID: string;
        payload: any;
    }];
}>;
