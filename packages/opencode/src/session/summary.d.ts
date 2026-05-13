import { MessageV2 } from "./message-v2";
export declare namespace SessionSummary {
    const summarize: any;
    const diff: any;
    function computeDiff(input: {
        messages: MessageV2.WithParts[];
    }): Promise<any>;
}
