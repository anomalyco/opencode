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
