/**
 * Event type definitions
 */

export type GlobalBusPayload = {
  type: string;
  properties: Record<string, any>;
};

export type GlobalBusEvent = {
  directory?: string;
  payload: GlobalBusPayload;
};

export type EventSink = (event: GlobalBusEvent) => Promise<void>;
