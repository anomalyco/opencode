import type { SerovalNode } from 'seroval';
import { createPlugin } from 'seroval';
import HeadersPlugin from './headers';
import ReadableStreamPlugin from './readable-stream';

function createResponseOptions(current: Response): ResponseInit {
  return {
    headers: current.headers,
    status: current.status,
    statusText: current.statusText,
  };
}

type ResponseNode = {
  body: SerovalNode;
  options: SerovalNode;
};

const ResponsePlugin = /* @__PURE__ */ createPlugin<Response, ResponseNode>({
  tag: 'seroval-plugins/web/Response',
  extends: [ReadableStreamPlugin, HeadersPlugin],
  test(value) {
    if (typeof Response === 'undefined') {
      return false;
    }
    return value instanceof Response;
  },
  parse: {
    async async(value, ctx) {
      return {
        body: await ctx.parse(
          value.body && !value.bodyUsed
            ? await value.clone().arrayBuffer()
            : null,
        ),
        options: await ctx.parse(createResponseOptions(value)),
      };
    },
    stream(value, ctx) {
      return {
        body: ctx.parse(
          value.body && !value.bodyUsed ? value.clone().body : null,
        ),
        options: ctx.parse(createResponseOptions(value)),
      };
    },
  },
  serialize(node, ctx) {
    return (
      'new Response(' +
      ctx.serialize(node.body) +
      ',' +
      ctx.serialize(node.options) +
      ')'
    );
  },
  deserialize(node, ctx) {
    return new Response(
      ctx.deserialize(node.body) as BodyInit,
      ctx.deserialize(node.options) as ResponseInit,
    );
  },
});

export default ResponsePlugin;
