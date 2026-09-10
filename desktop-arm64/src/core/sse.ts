export interface SseEvent {
  event: string;
  data: string;
}

export class SseParser {
  private buffer = "";
  private eventName = "";
  private dataLines: string[] = [];

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    let idx = this.buffer.indexOf("\n");
    while (idx !== -1) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      const ev = this.handleLine(line);
      if (ev) events.push(ev);
      idx = this.buffer.indexOf("\n");
    }
    return events;
  }

  flush(): SseEvent[] {
    if (this.buffer.length === 0) return [];
    const line = this.buffer.replace(/\r$/, "");
    this.buffer = "";
    const ev = this.handleLine(line);
    return ev ? [ev] : [];
  }

  private handleLine(line: string): SseEvent | undefined {
    if (line === "") {
      if (this.dataLines.length === 0 && this.eventName === "") return undefined;
      const data = this.dataLines.join("\n");
      const event = this.eventName || "message";
      this.eventName = "";
      this.dataLines = [];
      return { event, data };
    }
    if (line.startsWith(":")) return undefined;
    if (line.startsWith("event:")) {
      this.eventName = line.slice(6).trim();
      return undefined;
    }
    if (line.startsWith("data:")) {
      this.dataLines.push(line.slice(5).trimStart());
      return undefined;
    }
    return undefined;
  }
}

export async function* sseStream(
  body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
  decoder: TextDecoder = new TextDecoder(),
): AsyncGenerator<SseEvent> {
  const parser = new SseParser();
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    for (const ev of parser.push(decoder.decode(chunk, { stream: true }))) {
      yield ev;
    }
  }
  for (const ev of parser.push(decoder.decode())) {
    yield ev;
  }
  for (const ev of parser.flush()) {
    yield ev;
  }
}
