import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';

const selectorsSource = readFileSync(new URL('./selectors.js', import.meta.url), 'utf8');
const adapterSource = readFileSync(new URL('./chatgpt_dom_adapter.js', import.meta.url), 'utf8');

test('extracts every outer markdown block without duplicating nested blocks', () => {
  const selectors = runInNewContext(selectorsSource + '; ChatGPTSelectors');
  const nested = {innerText: 'nested', contains: () => false, querySelector: () => null};
  const first = {innerText: '第一段\r\n内容', contains: child => child === nested, querySelector: () => null};
  const last = {innerText: '最后一段 😀', contains: () => false, querySelector: () => null};
  const turn = {querySelectorAll: () => [first, nested, last]};
  assert.equal(selectors.answerText(turn), '第一段\n内容\n\n最后一段 😀');
});

test('extracts fenced tool JSON verbatim without code-block controls', () => {
  const selectors = runInNewContext(selectorsSource + '; ChatGPTSelectors');
  const content = 'def main():\n    if __name__ == "__main__":\n        print(__file__)\n';
  const payload = '<opencode_tool_call>' + JSON.stringify({name: 'write', arguments: {
    filePath: 'G:\\temp\\new.py', content,
  }}) + '</opencode_tool_call>';
  const code = {textContent: payload};
  const pre = {nodeType: 1, tagName: 'PRE', innerText: 'text\nCopy code\n' + payload,
    querySelector: selector => selector === 'code' ? code : null};
  const prose = {nodeType: 1, tagName: 'P', innerText: 'Writing the file.', querySelector: () => null};
  const block = {childNodes: [prose, pre], querySelector: () => pre, contains: () => false};
  const text = selectors.answerText({querySelectorAll: () => [block]});
  assert.equal(text, 'Writing the file.\n\n' + payload);
  assert.deepEqual(JSON.parse(text.slice(text.indexOf('>') + 1, text.lastIndexOf('<'))).arguments,
    {filePath: 'G:\\temp\\new.py', content});
});

test('refuses unfenced tool calls instead of silently executing rendered Markdown', () => {
  const selectors = runInNewContext(selectorsSource + '; ChatGPTSelectors');
  const copy = {textContent: '<opencode_tool_call>{"name":"write"}</opencode_tool_call>',
    querySelectorAll: () => []};
  assert.throws(() => selectors.validateToolText({cloneNode: () => copy}), /UNSAFE_TOOL_TEXT/);
  copy.querySelectorAll = () => [{remove: () => { copy.textContent = 'Done.'; }}];
  assert.doesNotThrow(() => selectors.validateToolText({cloneNode: () => copy}));
});

test('completion uses this conversation turn and a stable copy action', () => {
  const selectors = runInNewContext(selectorsSource + '; ChatGPTSelectors');
  const turn = {
    querySelector: () => null,
    closest: selector => {
      assert.equal(selector, 'article, [data-testid^="conversation-turn-"]');
      return {querySelectorAll: () => [{getAttribute: key =>
        key === 'data-testid' ? 'copy-turn-action-button' : 'Copier'}]};
    },
  };
  assert.equal(selectors.completed(turn), true);
  turn.querySelector = () => ({});
  assert.equal(selectors.completed(turn), false);
});

test('recognizes an image generation status without waiting for response text', () => {
  let status = {innerText: 'Creating image', getAttribute: () => null,
    getClientRects: () => [1]};
  const document = {querySelectorAll: selector => selector.includes('button') ? [] : [status]};
  const selectors = runInNewContext(selectorsSource + '; ChatGPTSelectors', {
    document, getComputedStyle: () => ({visibility: 'visible'}),
  });
  assert.equal(selectors.generating(), true);
  status = null;
  assert.equal(selectors.generating(), false);
});

test('recognizes unusual-activity restrictions as an account safety stop', () => {
  const turn = {innerText: 'Unusual activity has been detected from your device. Try again later.',
    getClientRects: () => [1]};
  const selectors = runInNewContext(selectorsSource + '; ChatGPTSelectors', {
    document: {querySelectorAll: () => []}, getComputedStyle: () => ({visibility: 'visible'}),
  });
  assert.match(selectors.restrictionError(turn), /Unusual activity/);
});

test('captures same-origin generated files and ignores unrelated remote images', async () => {
  const fetched = [];
  const image = {currentSrc: 'https://chatgpt.com/backend-api/files/generated.png', naturalWidth: 10};
  const remote = {currentSrc: 'https://unrelated.example/image.png', naturalWidth: 10};
  const pdf = {href: 'https://chatgpt.com/files/report.pdf', download: 'report.pdf'};
  const turn = {querySelectorAll: selector => selector === 'img' ? [image, remote] : [pdf]};
  const adapter = runInNewContext(adapterSource + '; new ChatGPTDomAdapter()', {
    crypto: {randomUUID: () => 'epoch'}, URL, btoa,
    location: {href: 'https://chatgpt.com/c/session', origin: 'https://chatgpt.com'},
    ChatGPTSelectors: {visible: () => true},
    fetch: async url => {
      fetched.push(url);
      return {
        ok: true,
        headers: {get: () => url.endsWith('.pdf') ? 'application/pdf' : 'image/png'},
        arrayBuffer: async () => new Uint8Array([0, 255]).buffer,
      };
    },
  });

  const files = await adapter.captureGeneratedFiles([turn]);
  assert.deepEqual(fetched, [image.currentSrc, pdf.href]);
  assert.equal(JSON.stringify(files.map(file => [file.filename, file.mediaType, file.data])), JSON.stringify([
    ['generated-image-1.png', 'image/png', 'AP8='],
    ['report.pdf', 'application/pdf', 'AP8='],
  ]));
});

test('coalesces text updates and force-flushes the final tail', async () => {
  let now = 5000;
  const events = [];
  const adapter = runInNewContext(adapterSource + '; new ChatGPTDomAdapter()', {
    crypto: {randomUUID: () => 'epoch'}, Date: {now: () => now},
  });
  const ctx = {emittedText: '', lastEmit: 0, revision: 0};
  const emit = async event => events.push(event);

  await adapter.emitTextUpdate(ctx, 'first', emit);
  now += 100;
  await adapter.emitTextUpdate(ctx, 'first and buffered', emit);
  assert.equal(events.length, 1);
  await adapter.emitTextUpdate(ctx, 'first and buffered', emit, true);
  now += 1600;
  await adapter.emitTextUpdate(ctx, 'rewritten', emit);

  assert.equal(JSON.stringify(events), JSON.stringify([
    {type: 'chat.delta', text: 'first', revision: 1, page_epoch: 'epoch'},
    {type: 'chat.delta', text: ' and buffered', revision: 2, page_epoch: 'epoch'},
    {type: 'chat.snapshot', text: 'rewritten', revision: 3, page_epoch: 'epoch'},
  ]));
});

test('readiness requires complete document, usable editor, and no generation', () => {
  const document = {title: '', readyState: 'loading', querySelector: () => null, querySelectorAll: () => []};
  const editor = {disabled: false, getAttribute: () => null};
  let generating = false;
  const adapter = runInNewContext(adapterSource + '; new ChatGPTDomAdapter()', {
    document, location: {href: 'https://chatgpt.com/'}, crypto: {randomUUID: () => 'epoch'},
    ChatGPTSelectors: {editor: () => editor, stop: () => generating, visible: () => true},
  });
  assert.equal(adapter.state(), 'LOADING');
  document.readyState = 'complete';
  editor.disabled = true;
  assert.notEqual(adapter.state(), 'READY');
  editor.disabled = false;
  assert.equal(adapter.state(), 'READY');
  generating = true;
  assert.equal(adapter.state(), 'GENERATING');
});

test('waitForReady restarts the settling window when hydration replaces the editor', async () => {
  let now = 0;
  const editors = [{}, {}];
  const adapter = runInNewContext(adapterSource + '; new ChatGPTDomAdapter()', {
    crypto: {randomUUID: () => 'epoch'}, Date: {now: () => now},
    ChatGPTSelectors: {editor: () => editors[now < 600 ? 0 : 1]},
  });
  adapter.state = () => now < 240 ? 'LOADING' : 'READY';
  adapter.pause = async ms => { now += ms; };
  await adapter.waitForReady();
  assert.ok(now >= 1300);
});

test('pastes attachments one at a time and waits for each upload to finish', async () => {
  let now = 0;
  const pastedFiles = [];
  const pasteTimes = [];
  const elements = [];
  const composer = {querySelectorAll: () => elements};
  let pendingUpload = null;
  const editor = {
    focus() {},
    contains: () => false,
    closest: selector => selector === 'form' ? composer : null,
    dispatchEvent(event) {
      assert.equal(event.type, 'paste');
      assert.equal(pendingUpload, null, 'the previous attachment must finish uploading first');
      assert.equal(event.clipboardData.items.values.length, 1, 'each paste event contains one attachment');
      const file = event.clipboardData.items.values[0];
      pastedFiles.push(file);
      pasteTimes.push(now);
      elements.push({innerText: file.name, contains: () => false, getAttribute: () => null});
      elements.push({innerText: '', contains: () => false, getAttribute: name =>
        name === 'aria-label' ? `移除文件：${file.name}` : null});
      const progress = {innerText: '上传中', contains: () => false, getAttribute: () => null};
      elements.push(progress);
      pendingUpload = {file, progress, readyAt: now + 360};
    },
  };
  class FileTransfer {
    constructor() { this.items = {values: [], add: file => this.items.values.push(file)}; }
  }
  class PastedFile {
    constructor(parts, name, options) {
      this.parts = parts;
      this.name = name;
      this.type = options.type;
    }
  }
  class PasteEvent {
    constructor(type, options) { this.type = type; this.clipboardData = options.clipboardData; }
  }
  const adapter = runInNewContext(adapterSource + '; new ChatGPTDomAdapter()', {
    atob, crypto: {randomUUID: () => 'epoch'}, DataTransfer: FileTransfer, File: PastedFile,
    ClipboardEvent: PasteEvent, Date: {now: () => now},
    ChatGPTSelectors: {
      editor: () => editor,
      send: () => ({disabled: pendingUpload !== null, getAttribute: () => pendingUpload ? 'true' : null}),
      visible: () => true,
    },
  });
  adapter.mutationOrTimeout = async ms => {
    now += ms;
    if (pendingUpload && now >= pendingUpload.readyAt) {
      elements.splice(elements.indexOf(pendingUpload.progress), 1);
      if (pendingUpload.file.type.startsWith('image/'))
        elements.push({tagName: 'IMG', naturalWidth: 12, contains: () => false, getAttribute: () => null});
      pendingUpload = null;
    }
  };
  await adapter.pasteAttachments(editor, [
    {filename: 'note.md', mediaType: 'text/markdown', data: 'AQID'},
    {filename: 'screen.png', mediaType: 'image/png', data: 'AP8='},
  ]);

  assert.equal(pastedFiles.length, 2);
  assert.deepEqual(pastedFiles.map(file => [file.name, file.type]), [
    ['note.md', 'text/markdown'], ['screen.png', 'image/png'],
  ]);
  assert.deepEqual(pasteTimes.length, 2);
  assert.ok(pasteTimes[1] >= 960, 'the second paste follows the first upload and its settle period');
  assert.deepEqual([...pastedFiles[0].parts[0]], [1, 2, 3]);
  assert.deepEqual([...pastedFiles[1].parts[0]], [0, 255]);
  assert.deepEqual(elements.filter(element => element.innerText).map(element => element.innerText), ['note.md', 'screen.png']);
  assert.ok(now >= 1920);
});
