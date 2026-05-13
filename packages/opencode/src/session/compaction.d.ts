import { SessionID, MessageID } from "./schema";
import { Provider } from "../provider/provider";
import { MessageV2 } from "./message-v2";
export declare namespace SessionCompaction {
    const Event: {
        Compacted: any;
    };
    function isOverflow(input: {
        tokens: MessageV2.Assistant["tokens"];
        model: Provider.Model;
    }): Promise<boolean>;
    const PRUNE_MINIMUM = 20000;
    const PRUNE_PROTECT = 40000;
    function prune(input: {
        sessionID: SessionID;
    }): Promise<void>;
    function process(input: {
        parentID: MessageID;
        messages: MessageV2.WithParts[];
        sessionID: SessionID;
        abort: AbortSignal;
        auto: boolean;
        overflow?: boolean;
    }): Promise<"continue" | "stop">;
    const create: any;
}
