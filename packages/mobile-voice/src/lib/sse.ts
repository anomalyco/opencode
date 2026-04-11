export type SSEMessage = {
  event?: string;
  data: string;
  id?: string;
};

function parseBlock(block: string): SSEMessage | null {
  if (!block.trim()) return null;

  const lines = block.split(/\r?\n/);
  let event: string | undefined;
  let id: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;

    const sep = line.indexOf(':');
    const field = sep === -1 ? line : line.slice(0, sep);
    const value = sep === -1 ? '' : line.slice(sep + 1).replace(/^\s/, '');

    if (field === 'event') {
      event = value;
      continue;
    }

    if (field === 'id') {
      id = value;
      continue;
    }

    if (field === 'data') {
      dataLines.push(value);
    }
  }

  if (dataLines.length === 0) return null;

  return {
    event,
    id,
    data: dataLines.join('\n'),
  };
}

export async function* parseSSEStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;

      pending += decoder.decode(result.value, { stream: true });
      const blocks = pending.split(/\r?\n\r?\n/);
      pending = blocks.pop() ?? '';

      for (const block of blocks) {
        const parsed = parseBlock(block);
        if (parsed) yield parsed;
      }
    }

    pending += decoder.decode();
    const tail = parseBlock(pending);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}
