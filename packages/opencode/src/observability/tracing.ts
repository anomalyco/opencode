/**
 * Manual Span Helpers for OpenCode Server
 * Utilities for creating spans in specific code paths
 */
import { trace, context, SpanKind, SpanStatusCode, type Span } from "@opentelemetry/api";

const SERVICE_NAME = "opencode-server";

/**
 * Create a span for session operations
 */
export function createSessionSpan(
  operation: "create" | "get" | "list" | "update" | "delete",
  sessionId?: string
): Span {
  const tracer = trace.getTracer(SERVICE_NAME);
  const span = tracer.startSpan(`opencode.session.${operation}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      "session.operation": operation,
      ...(sessionId ? { "session.id": sessionId } : {}),
    },
  });
  return span;
}

/**
 * Create a span for PTY operations
 */
export function createPtySpan(
  operation: "create" | "connect" | "write" | "resize" | "close",
  ptyId?: string
): Span {
  const tracer = trace.getTracer(SERVICE_NAME);
  const span = tracer.startSpan(`opencode.pty.${operation}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      "pty.operation": operation,
      ...(ptyId ? { "pty.id": ptyId } : {}),
    },
  });
  return span;
}

/**
 * Create a span for message/prompt operations
 */
export function createPromptSpan(sessionId: string, messageType: string): Span {
  const tracer = trace.getTracer(SERVICE_NAME);
  const span = tracer.startSpan("opencode.prompt", {
    kind: SpanKind.INTERNAL,
    attributes: {
      "session.id": sessionId,
      "message.type": messageType,
    },
  });
  return span;
}

/**
 * Create a span for tool execution
 */
export function createToolSpan(toolName: string, sessionId?: string): Span {
  const tracer = trace.getTracer(SERVICE_NAME);
  const span = tracer.startSpan(`opencode.tool.${toolName}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      "tool.name": toolName,
      ...(sessionId ? { "session.id": sessionId } : {}),
    },
  });
  return span;
}

/**
 * Helper to end a span with success status
 */
export function endSpanSuccess(span: Span, attributes?: Record<string, string | number | boolean>): void {
  if (attributes) {
    span.setAttributes(attributes);
  }
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

/**
 * Helper to end a span with error status
 */
export function endSpanError(span: Span, error: Error | string): void {
  const message = error instanceof Error ? error.message : error;
  span.setStatus({ code: SpanStatusCode.ERROR, message });
  if (error instanceof Error) {
    span.recordException(error);
  }
  span.end();
}

/**
 * Time tracking helper for first byte measurement
 */
export function createFirstByteTracker(): {
  markFirstByte: () => void;
  getDuration: () => number;
} {
  const start = performance.now();
  let firstByteTime: number | null = null;

  return {
    markFirstByte: () => {
      if (firstByteTime === null) {
        firstByteTime = performance.now();
      }
    },
    getDuration: () => {
      if (firstByteTime === null) {
        return -1;
      }
      return (firstByteTime - start) / 1000; // Return seconds
    },
  };
}
