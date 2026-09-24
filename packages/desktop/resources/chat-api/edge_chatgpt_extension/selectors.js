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
  generating() {
    if (this.stop()) return true;
    const status = [...document.querySelectorAll(
      '[aria-busy="true"], [role="progressbar"], [role="status"], [data-testid*="progress"], [data-testid*="generat"]',
    )].filter(this.visible);
    return status.some(element => /generat|creating image|drawing|rendering|processing|生成中|正在生成|正在创建|绘制中|处理中/i.test(
      [element.innerText, element.getAttribute('aria-label'), element.getAttribute('title'),
        element.getAttribute('data-testid')].filter(Boolean).join('\n'),
    ));
  },
  generationError(turn) {
    const elements = [
      ...document.querySelectorAll('[role="alert"], [data-testid*="error"], [data-testid*="toast"]'),
      ...(turn ? [turn] : []),
    ].filter(this.visible);
    const failure = elements.map(element => element.innerText || '').find(text =>
      /image generation failed|failed to generate|couldn.t generate|there was an error generating|生成失败|图片生成失败|生成内容时出错/i.test(text),
    );
    return failure?.trim().slice(0, 500);
  },
  restrictionError(turn) {
    const elements = [
      ...document.querySelectorAll('[role="alert"], [data-testid*="error"], [data-testid*="toast"]'),
      ...(turn ? [turn] : []),
    ].filter(this.visible);
    const restriction = elements.map(element => element.innerText || '').find(text =>
      /unusual activity has been detected|suspicious activity|异常活动|可疑活动|检测到异常/i.test(text),
    );
    return restriction?.trim().slice(0, 500);
  },
  generatedMedia(turn) {
    if (!turn) return false;
    return this.generatedMediaCount(turn) > 0;
  },
  generatedMediaCount(turn) {
    if (!turn) return 0;
    return [...turn.querySelectorAll('img')].filter(image => this.visible(image) && image.naturalWidth > 0).length +
      [...turn.querySelectorAll('a[download]')].filter(this.visible).length;
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
