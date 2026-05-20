interface MessagePart {
    type?: string;
    name?: string;
    toolName?: string;
}
interface Message {
    info?: {
        role?: string;
    };
    role?: string;
    parts?: MessagePart[];
}
export declare function hasUnansweredQuestion(messages: Message[]): boolean;
export {};
