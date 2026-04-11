import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** @type {Map<string, {jobID: string, sessionID: string, opencodeBaseURL: string, relayBaseURL: string, expoPushToken: string, createdAt: number, done: boolean}>} */
const jobs = new Map();

/** @type {Map<string, {key: string, opencodeBaseURL: string, abortController: AbortController, sessions: Set<string>, running: boolean}>} */
const streams = new Map();

/** @type {Set<string>} */
const dedupe = new Set();

function json(res, status, body) {
  const value = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(value),
  });
  res.end(value);
}

async function readJSON(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) {
      throw new Error('Payload too large');
    }
  }
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function extractSessionID(event) {
  const properties = event?.properties ?? {};
  if (typeof properties.sessionID === 'string') return properties.sessionID;
  if (properties.info && typeof properties.info === 'object' && typeof properties.info.sessionID === 'string') {
    return properties.info.sessionID;
  }
  if (properties.part && typeof properties.part === 'object' && typeof properties.part.sessionID === 'string') {
    return properties.part.sessionID;
  }
  return null;
}

function classifyEvent(event) {
  const type = String(event?.type || '');
  const lower = type.toLowerCase();

  if (lower.includes('permission')) return 'permission';
  if (lower.includes('error')) return 'error';

  if (type === 'session.status') {
    const statusType = event?.properties?.status?.type;
    if (statusType === 'idle') return 'complete';
  }

  if (type === 'message.updated') {
    const info = event?.properties?.info;
    if (info && typeof info === 'object') {
      if (info.error) return 'error';
      if (info.role === 'assistant' && info.time && typeof info.time === 'object' && info.time.completed) {
        return 'complete';
      }
    }
  }

  return null;
}

function notificationBody(eventType) {
  if (eventType === 'complete') {
    return {
      title: 'Session complete',
      body: 'OpenCode finished your monitored prompt.',
    };
  }
  if (eventType === 'permission') {
    return {
      title: 'Action needed',
      body: 'OpenCode needs a permission decision.',
    };
  }
  return {
    title: 'Session error',
    body: 'OpenCode reported an error for your monitored session.',
  };
}

async function sendPush({ expoPushToken, eventType, sessionID, jobID }) {
  const dedupeKey = `${jobID}:${eventType}`;
  if (dedupe.has(dedupeKey)) return;
  dedupe.add(dedupeKey);

  const text = notificationBody(eventType);

  const payload = {
    to: expoPushToken,
    priority: 'high',
    _contentAvailable: true,
    data: {
      eventType,
      sessionID,
      jobID,
      title: text.title,
      body: text.body,
      dedupeKey,
      at: Date.now(),
    },
  };

  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Push send failed (${response.status}): ${body || response.statusText}`);
  }
}

async function* parseSSE(readable) {
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let pending = '';

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;

      pending += decoder.decode(next.value, { stream: true });
      const blocks = pending.split(/\r?\n\r?\n/);
      pending = blocks.pop() || '';

      for (const block of blocks) {
        const lines = block.split(/\r?\n/);
        const dataLines = [];
        for (const line of lines) {
          if (!line || line.startsWith(':')) continue;
          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
        if (dataLines.length > 0) {
          yield dataLines.join('\n');
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function cleanupStreamIfUnused(baseURL) {
  const key = baseURL.replace(/\/+$/, '');
  const entry = streams.get(key);
  if (!entry) return;

  const stillUsed = Array.from(jobs.values()).some((job) => !job.done && job.opencodeBaseURL === key);
  if (stillUsed) return;

  entry.abortController.abort();
  streams.delete(key);
}

async function runStream(baseURL) {
  const key = baseURL.replace(/\/+$/, '');
  if (streams.has(key)) return;

  const abortController = new AbortController();
  streams.set(key, {
    key,
    opencodeBaseURL: key,
    abortController,
    sessions: new Set(),
    running: true,
  });

  while (!abortController.signal.aborted) {
    try {
      const response = await fetch(`${key}/event`, {
        signal: abortController.signal,
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });

      if (!response.ok || !response.body) {
        throw new Error(`SSE connect failed (${response.status})`);
      }

      for await (const data of parseSSE(response.body)) {
        if (abortController.signal.aborted) break;

        let event;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }

        const sessionID = extractSessionID(event);
        if (!sessionID) continue;

        const eventType = classifyEvent(event);
        if (!eventType) continue;

        const related = Array.from(jobs.values()).filter(
          (job) => !job.done && job.opencodeBaseURL === key && job.sessionID === sessionID,
        );
        if (related.length === 0) continue;

        await Promise.allSettled(
          related.map(async (job) => {
            await sendPush({
              expoPushToken: job.expoPushToken,
              eventType,
              sessionID,
              jobID: job.jobID,
            });

            if (eventType === 'complete' || eventType === 'error') {
              const current = jobs.get(job.jobID);
              if (current) current.done = true;
            }
          }),
        );
      }
    } catch (error) {
      if (abortController.signal.aborted) break;
      console.warn('[relay] SSE loop error:', error instanceof Error ? error.message : String(error));
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
}

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    json(res, 400, { ok: false, error: 'Invalid request' });
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    json(res, 200, {
      ok: true,
      activeJobs: Array.from(jobs.values()).filter((job) => !job.done).length,
      streams: streams.size,
    });
    return;
  }

  if (req.url === '/v1/monitor/start' && req.method === 'POST') {
    try {
      const body = await readJSON(req);
      const jobID = String(body.jobID || '').trim();
      const sessionID = String(body.sessionID || '').trim();
      const opencodeBaseURL = String(body.opencodeBaseURL || '').trim().replace(/\/+$/, '');
      const relayBaseURL = String(body.relayBaseURL || '').trim().replace(/\/+$/, '');
      const expoPushToken = String(body.expoPushToken || '').trim();

      if (!jobID || !sessionID || !opencodeBaseURL || !expoPushToken) {
        json(res, 400, { ok: false, error: 'Missing required fields' });
        return;
      }

      jobs.set(jobID, {
        jobID,
        sessionID,
        opencodeBaseURL,
        relayBaseURL,
        expoPushToken,
        createdAt: Date.now(),
        done: false,
      });

      runStream(opencodeBaseURL).catch((error) => {
        console.warn('[relay] runStream failed:', error instanceof Error ? error.message : String(error));
      });

      json(res, 200, { ok: true });
      return;
    } catch (error) {
      json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  if (req.url === '/v1/monitor/stop' && req.method === 'POST') {
    try {
      const body = await readJSON(req);
      const jobID = String(body.jobID || '').trim();
      const token = String(body.expoPushToken || '').trim();

      if (!jobID || !token) {
        json(res, 400, { ok: false, error: 'Missing required fields' });
        return;
      }

      const job = jobs.get(jobID);
      if (job && job.expoPushToken === token) {
        job.done = true;
        cleanupStreamIfUnused(job.opencodeBaseURL);
      }

      json(res, 200, { ok: true });
      return;
    } catch (error) {
      json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  json(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[relay] listening on http://${HOST}:${PORT}`);
});
