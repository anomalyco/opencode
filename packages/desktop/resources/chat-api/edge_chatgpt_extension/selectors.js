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
  answerBody(turn) {
    return turn?.querySelector('.markdown') || turn?.querySelector('[data-message-content]') || null;
  },
  completed(turn) {
    const wrapper = turn?.parentElement?.parentElement;
    return !!wrapper && [...wrapper.querySelectorAll('button')].some(button =>
      /^(复制回复|Copy response|Copy answer)$/i.test(button.getAttribute('aria-label') || ''));
  },
};
