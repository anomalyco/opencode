/**
 * Schedules a deferred SQLite update to change the message model in the DB
 * WITHOUT triggering a Bus event. Uses microtask retry loop to wait for
 * Session.updateMessage() to save the message first, then overwrites the model.
 *
 * Falls back to setTimeout(fn, 0) after 10 microtask attempts.
 */
export declare function scheduleDeferredModelOverride(messageId: string, targetModel: {
    providerID: string;
    modelID: string;
}, variant?: string): void;
