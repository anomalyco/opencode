import type { SerovalNode } from 'seroval';
import { createPlugin } from 'seroval';
import HeadersPlugin from './headers';
import ReadableStreamPlugin from './readable-stream';

function createRequestOptions(
  current: Request,
  body: ArrayBuffer | ReadableStream | null,
): RequestInit {
  return {
    body,
    cache: current.cache,
    credentials: current.credentials,
    headers: current.headers,
    integrity: current.integrity,
    keepalive: current.keepalive,
    method: current.method,
    mode: current.mode,
    redirect: current.redirect,
    referrer: current.referrer,
    referrerPolicy: current.referrerPolicy,
  };
}

type RequestNode = {
  url: SerovalNode;
  options: SerovalNode;
};

const RequestPlugin = /* @__PURE__ */ createPlugin<Request, RequestNode>({
  tag: 'seroval-plugins/web/Request',
  extends: [ReadableStreamPlugin, HeadersPlugin],
  test(value) {
    if (typeof Request === 'undefined') {
      return false;
    }
    return value instanceof Request;
  },
  parse: {
    async async(value, ctx) {
      return {
        url: await ctx.parse(value.url),
        options: await ctx.parse(
          createRequestOptions(
            value,
            value.body && !value.bodyUsed
              ? await value.clone().arrayBuffer()
              : null,
          ),
        ),
      };
    },
    stream(value, ctx) {
      return {
        url: ctx.parse(value.url),
        options: ctx.parse(
          createRequestOptions(
            value,
            value.body && !value.bodyUsed ? value.clone().body : null,
          ),
        ),
      };
    },
  },
  serialize(node, ctx) {
    return (
      'new Request(' +
      ctx.serialize(node.url) +
      ',' +
      ctx.serialize(node.options) +
      ')'
    );
  },
  deserialize(node, ctx) {
    return new Request(
      ctx.deserialize(node.url) as string,
      ctx.deserialize(node.options) as RequestInit,
    );
  },
});

export default RequestPlugin;
