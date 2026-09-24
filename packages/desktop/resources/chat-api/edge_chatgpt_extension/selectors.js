/* One place for ChatGPT's observable page controls. */
const ChatGPTSelectors = {
  visible(element) {
    return !!element && element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== 'hidden';
  },
  one(selectors) {
    for (const selector of selectors) {
      const matches = [...document.querySelectorAll(selector)].filter(this.visible);
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) throw new Error('DOM_CHANGED: 页面控件不唯一：' + selector);
    }
    return null;
  },
  editor() {
    return this.one([
      '#prompt-textarea[contenteditable="true"]',
      '[role="textbox"][contenteditable="true"][aria-multiline="true"]',
      'textarea[name="prompt-textarea"]',
    ]);
  },
  send() {
    return this.one([
      'button[data-testid="send-button"]',
      'button#composer-submit-button[aria-label*="发送"]',
      'button#composer-submit-button[aria-label*="Send"]',
    ]);
  },
  stop() {
    return this.one([
      'button[data-testid="stop-button"]',
      'button#composer-submit-button[aria-label*="停止"]',
      'button#composer-submit-button[aria-label*="Stop"]',
    ]);
  },
  turns() {
    return [...document.querySelectorAll('[data-message-author-role][data-message-id]')];
  },
  answerText(turn) {
    if (!turn) return '';
    const markdown = [...turn.querySelectorAll('.markdown')];
    const blocks = markdown.length ? markdown : [...turn.querySelectorAll('[data-message-content]')];
    return blocks.filter(block => !blocks.some(parent => parent !== block && parent.contains(block)))
      .map(block => this.markdownText(block).replace(/\r\n/g, '\n').trimEnd()).join('\n\n');
  },
  markdownText(block) {
    // Read fenced payloads verbatim, excluding language labels and copy buttons.
    // innerText collapses spaces; rendered prose has already lost Markdown escapes.
    if (block.tagName === 'PRE') {
      const code = block.querySelector('code');
      return code ? code.textContent : block.textContent;
    }
    if (!block.querySelector('pre')) return block.innerText;
    return [...block.childNodes].map(node => {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1) return '';
      return this.markdownText(node);
    }).join('\n\n');
  },
  validateToolText(turn) {
    // A rendered paragraph cannot be inverted reliably into the original JSON.
    // Fail closed instead of executing code whose whitespace or escapes changed.
    const copy = turn.cloneNode(true);
    copy.querySelectorAll('pre').forEach(node => node.remove());
    if (/<\/?opencode_tool_call>|<\/?[|｜]DSML[|｜]/.test(copy.textContent))
      throw new Error('UNSAFE_TOOL_TEXT: 工具指令未放在代码块中，Markdown 可能已损坏参数。请重试并要求使用代码块。');
  },
  completed(turn) {
    if (turn?.querySelector('.streaming-animation')) return false;
    const wrapper = turn?.closest('article, [data-testid^="conversation-turn-"]');
    return !!wrapper && [...wrapper.querySelectorAll('button')].some(button =>
      button.getAttribute('data-testid') === 'copy-turn-action-button' ||
      /^(复制|复制回复|复制回答|Copy|Copy response|Copy answer)$/i.test(button.getAttribute('aria-label') || ''));
  },
};
