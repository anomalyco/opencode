import assert from 'assert';
import { _iterSSEMessages } from '@opencode-ai/sdk/core/streaming';
import { ReadableStreamFrom } from '@opencode-ai/sdk/internal/shims';

describe('streaming decoding', () => {
  test('basic', async () => {
    async function* body(): AsyncGenerator<Buffer> {
      yield Buffer.from('event: completion\n');
      yield Buffer.from('data: {"foo":true}\n');
      yield Buffer.from('\n');
    }

    const stream = _iterSSEMessages(new Response(ReadableStreamFrom(body())), new AbortController())[
      Symbol.asyncIterator
    ]();

    let event = await stream.next();
    assert(event.value);
    expect(JSON.parse(event.value.data)).toEqual({ foo: true });

    event = await stream.next();
    expect(event.done).toBeTruthy();
  });

  test('data without event', async () => {
    async function* body(): AsyncGenerator<Buffer> {
      yield Buffer.from('data: {"foo":true}\n');
      yield Buffer.from('\n');
    }

    const stream = _iterSSEMessages(new Response(ReadableStreamFrom(body())), new AbortController())[
      Symbol.asyncIterator
    ]();

    let event = await stream.next();
    assert(event.value);
    expect(event.value.event).toBeNull();
    expect(JSON.parse(event.value.data)).toEqual({ foo: true });

    event = await stream.next();
    expect(event.done).toBeTruthy();
  });

  test('event without data', async () => {
    async function* body(): AsyncGenerator<Buffer> {
      yield Buffer.from('event: foo\n');
      yield Buffer.from('\n');
    }

    const stream = _iterSSEMessages(new Response(ReadableStreamFrom(body())), new AbortController())[
      Symbol.asyncIterator
    ]();

    let event = await stream.next();
    assert(event.value);
    expect(event.value.event).toEqual('foo');
    expect(event.value.data).toEqual('');

    event = await stream.next();
    expect(event.done).toBeTruthy();
  });

  test('multiple events', async () => {
    async function* body(): AsyncGenerator<Buffer> {
      yield Buffer.from('event: foo\n');
      yield Buffer.from('\n');
      yield Buffer.from('event: ping\n');
      yield Buffer.from('\n');
    }

    const stream = _iterSSEMessages(new Response(ReadableStreamFrom(body())), new AbortController())[
      Symbol.asyncIterator
    ]();

    let event = await stream.next();
    assert(event.value);
    expect(event.value.event).toEqual('foo');
    expect(event.value.data).toEqual('');

    event = await stream.next();
    assert(event.value);
    expect(event.value.event).toEqual('ping');
    expect(event.value.data).toEqual('');

    event = await stream.next();
    expect(event.done).toBeTruthy();
  });

  test('multiple events with data', async () => {
    async function* body(): AsyncGenerator<Buffer> {
      yield Buffer.from('event: foo\n');
      yield Buffer.from('data: {"foo":true}\n');
      yield Buffer.from('\n');
      yield Buffer.from('event: ping\n');
      yield Buffer.from('data: {"bar":false}\n');
      yield Buffer.from('\n');
    }

    const stream = _iterSSEMessages(new Response(ReadableStreamFrom(body())), new AbortController())[
      Symbol.asyncIterator
    ]();

    let event = await stream.next();
    assert(event.value);
    expect(event.value.event).toEqual('foo');
    expect(JSON.parse(event.value.data)).toEqual({ foo: true });

    event = await stream.next();
    assert(event.value);
    expect(event.value.event).toEqual('ping');
    expect(JSON.parse(event.value.data)).toEqual({ bar: false });

    event = await stream.next();
    expect(event.done).toBeTruthy();
  });

  test('multiple data lines with empty line', async () => {
    async function* body(): AsyncGenerator<Buffer> {
      yield Buffer.from('event: ping\n');
      yield Buffer.from('data: {\n');
      yield Buffer.from('data: "foo":\n');
      yield Buffer.from('data: \n');
      yield Buffer.from('data:\n');
      yield Buffer.from('data: true}\n');
      yield Buffer.from('\n\n');
    }

    const stream = _iterSSEMessages(new Response(ReadableStreamFrom(body())), new AbortController())[
      Symbol.asyncIterator
    ]();

    let event = await stream.next();
    assert(event.value);
    expect(event.value.event).toEqual('ping');
    expect(JSON.parse(event.value.data)).toEqual({ foo: true });
    expect(event.value.data).toEqual('{\n"foo":\n\n\ntrue}');

    event = await stream.next();
    expect(event.done).toBeTruthy();
  });

  test('data json escaped double new line', async () => {
    async function* body(): AsyncGenerator<Buffer> {
      yield Buffer.from('event: ping\n');
      yield Buffer.from('data: {"foo": "my long\\n\\ncontent"}');
      yield Buffer.from('\n\n');
    }

    const stream = _iterSSEMessages(new Response(ReadableStreamFrom(body())), new AbortController())[
      Symbol.asyncIterator
    ]();

    let event = await stream.next();
    assert(event.value);
    expect(event.value.event).toEqual('ping');
    expect(JSON.parse(event.value.data)).toEqual({ foo: 'my long\n\ncontent' });

    event = await stream.next();
    expect(event.done).toBeTruthy();
  });

  test('special new line characters', async () => {
    async function* body(): AsyncGenerator<Buffer> {
      yield Buffer.from('data: {"content": "culpa "}\n');
      yield Buffer.from('\n');
      yield Buffer.from('data: {"content": "');
      yield Buffer.from([0xe2, 0x80, 0xa8]);
      yield Buffer.from('"}\n');
      yield Buffer.from('\n');
      yield Buffer.from('data: {"content": "foo"}\n');
      yield Buffer.from('\n');
    }

    const stream = _iterSSEMessages(new Response(ReadableStreamFrom(body())), new AbortController())[
      Symbol.asyncIterator
    ]();

    let event = await stream.next();
    assert(event.value);
    expect(JSON.parse(event.value.data)).toEqual({ content: 'culpa ' });

    event = await stream.next();
    assert(event.value);
    expect(JSON.parse(event.value.data)).toEqual({ content: Buffer.from([0xe2, 0x80, 0xa8]).toString() });

    event = await stream.next();
    assert(event.value);
    expect(JSON.parse(event.value.data)).toEqual({ content: 'foo' });

    event = await stream.next();
    expect(event.done).toBeTruthy();
  });

  test('multi-byte characters across chunks', async () => {
    async function* body(): AsyncGenerator<Buffer> {
      yield Buffer.from('event: completion\n');
      yield Buffer.from('data: {"content": "');
      // bytes taken from the string 'известни' and arbitrarily split
      // so that some multi-byte characters span multiple chunks
      yield Buffer.from([0xd0]);
      yield Buffer.from([0xb8, 0xd0, 0xb7, 0xd0]);
      yield Buffer.from([0xb2, 0xd0, 0xb5, 0xd1, 0x81, 0xd1, 0x82, 0xd0, 0xbd, 0xd0, 0xb8]);
      yield Buffer.from('"}\n');
      yield Buffer.from('\n');
    }

    const stream = _iterSSEMessages(new Response(ReadableStreamFrom(body())), new AbortController())[
      Symbol.asyncIterator
    ]();

    let event = await stream.next();
    assert(event.value);
    expect(event.value.event).toEqual('completion');
    expect(JSON.parse(event.value.data)).toEqual({ content: 'известни' });

    event = await stream.next();
    expect(event.done).toBeTruthy();
  });
});
