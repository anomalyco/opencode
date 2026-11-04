import type { SerovalNode } from 'seroval';
import { createPlugin } from 'seroval';

function createEventOptions(current: Event): EventInit {
  return {
    bubbles: current.bubbles,
    cancelable: current.cancelable,
    composed: current.composed,
  };
}

type EventNode = {
  type: SerovalNode;
  options: SerovalNode;
};

const EventPlugin = /* @__PURE__ */ createPlugin<Event, EventNode>({
  tag: 'seroval-plugins/web/Event',
  test(value) {
    if (typeof Event === 'undefined') {
      return false;
    }
    return value instanceof Event;
  },
  parse: {
    sync(value, ctx) {
      return {
        type: ctx.parse(value.type),
        options: ctx.parse(createEventOptions(value)),
      };
    },
    async async(value, ctx) {
      return {
        type: await ctx.parse(value.type),
        options: await ctx.parse(createEventOptions(value)),
      };
    },
    stream(value, ctx) {
      return {
        type: ctx.parse(value.type),
        options: ctx.parse(createEventOptions(value)),
      };
    },
  },
  serialize(node, ctx) {
    return (
      'new Event(' +
      ctx.serialize(node.type) +
      ',' +
      ctx.serialize(node.options) +
      ')'
    );
  },
  deserialize(node, ctx) {
    return new Event(
      ctx.deserialize(node.type) as string,
      ctx.deserialize(node.options) as EventInit,
    );
  },
});

export default EventPlugin;
