import { z } from "zod";
export declare const OpenClawGatewaySchema: z.ZodObject<{
    type: z.ZodDefault<z.ZodEnum<{
        command: "command";
        http: "http";
    }>>;
    url: z.ZodOptional<z.ZodString>;
    method: z.ZodDefault<z.ZodString>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    command: z.ZodOptional<z.ZodString>;
    timeout: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const OpenClawHookSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    gateway: z.ZodString;
    instruction: z.ZodString;
}, z.core.$strip>;
export declare const OpenClawReplyListenerConfigSchema: z.ZodObject<{
    discordBotToken: z.ZodOptional<z.ZodString>;
    discordChannelId: z.ZodOptional<z.ZodString>;
    discordMention: z.ZodOptional<z.ZodString>;
    authorizedDiscordUserIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    telegramBotToken: z.ZodOptional<z.ZodString>;
    telegramChatId: z.ZodOptional<z.ZodString>;
    pollIntervalMs: z.ZodDefault<z.ZodNumber>;
    rateLimitPerMinute: z.ZodDefault<z.ZodNumber>;
    maxMessageLength: z.ZodDefault<z.ZodNumber>;
    includePrefix: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const OpenClawConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    gateways: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        type: z.ZodDefault<z.ZodEnum<{
            command: "command";
            http: "http";
        }>>;
        url: z.ZodOptional<z.ZodString>;
        method: z.ZodDefault<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        command: z.ZodOptional<z.ZodString>;
        timeout: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>>;
    hooks: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        gateway: z.ZodString;
        instruction: z.ZodString;
    }, z.core.$strip>>>;
    replyListener: z.ZodOptional<z.ZodObject<{
        discordBotToken: z.ZodOptional<z.ZodString>;
        discordChannelId: z.ZodOptional<z.ZodString>;
        discordMention: z.ZodOptional<z.ZodString>;
        authorizedDiscordUserIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
        telegramBotToken: z.ZodOptional<z.ZodString>;
        telegramChatId: z.ZodOptional<z.ZodString>;
        pollIntervalMs: z.ZodDefault<z.ZodNumber>;
        rateLimitPerMinute: z.ZodDefault<z.ZodNumber>;
        maxMessageLength: z.ZodDefault<z.ZodNumber>;
        includePrefix: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type OpenClawConfig = z.infer<typeof OpenClawConfigSchema>;
export type OpenClawGateway = z.infer<typeof OpenClawGatewaySchema>;
export type OpenClawHook = z.infer<typeof OpenClawHookSchema>;
export type OpenClawReplyListenerConfig = z.infer<typeof OpenClawReplyListenerConfigSchema>;
