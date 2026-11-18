// More examples here on how to parse responses from Cloudflare API
// https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/routes.ts

const CLOUDFLARE_API_BASE_URL =
  process.env.CLOUDFLARE_API_BASE_URL ?? "https://api.cloudflare.com/client/v4";
const CLOUDFLARE_API_TOKEN =
  $app.providers?.cloudflare?.apiToken || process.env.CLOUDFLARE_API_TOKEN;

export interface FetchError {
  code: number;
  message: string;
  error_chain?: FetchError[];
}

export interface FetchResult<ResultType> {
  success: boolean;
  result: ResultType;
  errors: FetchError[];
  messages?: string[];
  result_info?: {
    page: number;
    per_page: number;
    count: number;
    total_count: number;
  };
}

export async function cfFetch<ResultType>(
  resource: string,
  init: RequestInit = {},
) {
  const maxRetries = 3;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const ret = await fetch(`${CLOUDFLARE_API_BASE_URL}${resource}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
          ...init.headers,
        },
      });

      const json = (await ret.json()) as FetchResult<ResultType>;
      // ie.
      // {
      //   "result": {
      //     "subdomain": "wangfanjie"
      //   },
      //   "success": true,
      //   "errors": [],
      //   "messages": []
      // }
      if (json.success) {
        return json;
      }

      lastError = new Error(
        `A request to the Cloudflare API (${resource}) failed.`,
      );
      // @ts-expect-error attach the errors to the error object
      lastError.errors = json.errors;
      // @ts-expect-error attach the messages to the error object
      lastError.messages = json.messages;
    } catch (error: any) {
      lastError = error;
    }

    // Retry with exponential backoff
    if (attempt < maxRetries) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 200),
      );
    }
  }

  throw lastError;
}
