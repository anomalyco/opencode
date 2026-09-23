/* Runs in an isolated content-script world. No private ChatGPT modules/API. */
class ChatGPTDomAdapter {
  constructor() {
    this.pageEpoch = crypto.randomUUID();
    this.active = null;
  }

  state() {
    if (!location.href.startsWith('https://chatgpt.com/')) return 'ERROR';
    if (/just a moment|verify you are human|稍等片刻|验证您是人类/i.test(document.title) ||
        document.querySelector('iframe[src*="challenges.cloudflare.com"]')) return 'CHALLENGE_REQUIRED';
    try {
      if (ChatGPTSelectors.editor()) return this.active ? 'GENERATING' : 'READY';
    } catch { return 'DOM_CHANGED'; }
    if ([...document.querySelectorAll('a[href*="/auth/login"],a[href*="/auth/signup"]')]
        .some(ChatGPTSelectors.visible)) return 'LOGIN_REQUIRED';
    return document.readyState === 'loading' ? 'LOADING' : 'DOM_CHANGED';
  }

  health() {
    return {state: this.state(), page_epoch: this.pageEpoch, url: location.href,
            adapter_version: '0.2.4'};
  }

  async waitForReady(timeout = 25000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const state = this.state();
      if (state === 'READY') return;
      if (state === 'LOGIN_REQUIRED' || state === 'CHALLENGE_REQUIRED')
        throw new Error(state + ': 请在专用 Edge 标签页完成网页操作');
      await this.pause(120);
    }
    throw new Error(this.state() + ': 输入框未就绪');
  }

  async resetEditor() {
    if (this.active) throw new Error('BUSY: 正在生成回答');
    await this.waitForReady();
    const editor = ChatGPTSelectors.editor();
    if (!editor) throw new Error('DOM_CHANGED: 新聊天没有输入框');
    if (this.editorText(editor).trim()) {
      editor.focus();
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
      if (!document.execCommand('delete')) throw new Error('INPUT_REJECTED: 无法清除新聊天草稿');
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const current = ChatGPTSelectors.editor();
        if (current && !this.editorText(current).trim()) return this.health();
        await this.pause(50);
      }
      throw new Error('PAGE_INTERFERED: 新聊天仍有草稿');
    }
    return this.health();
  }

  pause(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async mutationOrTimeout(ms) {
    await new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve();
      };
      const observer = new MutationObserver(finish);
      observer.observe(document.body, {subtree: true, childList: true, characterData: true});
      const timer = setTimeout(finish, ms);
    });
  }

  editorText(editor) {
    if (editor.tagName === 'TEXTAREA') return editor.value;
    // ProseMirror renders adjacent paragraphs with a blank line in innerText.
    return [...editor.children].map(child => child.innerText.replace(/\n$/, '')).join('\n');
  }

  async fillEditor(editor, text) {
    if (this.editorText(editor).trim()) throw new Error('PAGE_INTERFERED: 输入框已有用户内容');
    editor.focus();
    if (editor.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(editor, text);
      editor.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: text}));
    } else if (!document.execCommand('insertText', false, text)) {
      throw new Error('INPUT_REJECTED: 富文本编辑器未接受输入');
    }
    const expected = text.replace(/\r\n/g, '\n');
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const currentEditor = ChatGPTSelectors.editor() || editor;
      const actual = this.editorText(currentEditor).replace(/\r\n/g, '\n');
      if (actual === expected) return;
      await this.pause(50);
    }
    throw new Error('INPUT_REJECTED: 输入内容与请求不一致');
  }

  async digest(text) {
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return {bytes: bytes.length, sha256: [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('')};
  }

  async runChat(job, emit) {
    if (this.active) throw new Error('BUSY: 页面正在处理另一条消息');
    if (typeof job.text !== 'string' || !job.text.trim() || new TextEncoder().encode(job.text).length > 100000)
      throw new Error('BAD_PROMPT: 消息为空或超过 100 KB');
    await this.waitForReady();
    const editor = ChatGPTSelectors.editor();
    if (!editor) throw new Error('DOM_CHANGED: 未找到唯一输入框');
    const baseline = new Set(ChatGPTSelectors.turns().map(e => e.getAttribute('data-message-id')));
    const startURL = location.pathname;
    const ctx = {jobId: job.id, stopRequested: false, submitted: false, lastText: '', revision: 0,
                 baseline, startURL};
    this.active = ctx;
    let terminal = false;
    try {
      await emit({type: 'chat.accepted', page_epoch: this.pageEpoch});
      await this.fillEditor(editor, job.text);
      let send = null;
      const sendDeadline = Date.now() + 3000;
      while (Date.now() < sendDeadline) {
        send = ChatGPTSelectors.send();
        if (send && !send.disabled && send.getAttribute('aria-disabled') !== 'true') break;
        await this.pause(50);
      }
      if (!send || send.disabled || send.getAttribute('aria-disabled') === 'true')
        throw new Error('INPUT_REJECTED: 发送按钮未就绪');
      send.click();
      const submitDeadline = Date.now() + 15000;
      let userTurn = null;
      while (Date.now() < submitDeadline) {
        const newUserTurns = ChatGPTSelectors.turns().filter(turn =>
          turn.getAttribute('data-message-author-role') === 'user' &&
          !baseline.has(turn.getAttribute('data-message-id')));
        if (newUserTurns.length > 1) throw new Error('PAGE_INTERFERED: 页面出现多条新用户消息');
        if (newUserTurns.length === 1 && newUserTurns[0].innerText.trim() &&
            !this.editorText(ChatGPTSelectors.editor() || editor).trim()) {
          userTurn = newUserTurns[0];
          break;
        }
        await this.mutationOrTimeout(150);
      }
      if (!userTurn) throw new Error('SUBMISSION_UNKNOWN: 未见本轮用户消息，禁止自动重发');
      ctx.submitted = true;
      const userId = userTurn.getAttribute('data-message-id');
      await emit({type: 'chat.submitted', page_epoch: this.pageEpoch, url: location.href});
      const totalDeadline = Date.now() + 180000;
      const firstDeadline = Date.now() + 60000;
      let lastProgress = Date.now();
      let stableSince = Date.now();
      while (Date.now() < totalDeadline) {
        if (location.pathname !== startURL && startURL !== '/' && !startURL.startsWith('/?'))
          throw new Error('SESSION_LOST: 会话页面发生切换');
        const turns = ChatGPTSelectors.turns();
        const userIndex = turns.findIndex(e => e.getAttribute('data-message-id') === userId);
        if (userIndex < 0) throw new Error('SESSION_LOST: 本轮消息已从页面消失');
        const following = turns.slice(userIndex + 1);
        if (following.some(e => e.getAttribute('data-message-author-role') === 'user'))
          throw new Error('PAGE_INTERFERED: 页面出现另一条用户消息');
        const answer = following.find(e => e.getAttribute('data-message-author-role') === 'assistant');
        const body = ChatGPTSelectors.answerBody(answer);
        const current = body ? body.innerText.replace(/\r\n/g, '\n').trimEnd() : '';
        if (current !== ctx.lastText) {
          if (current.startsWith(ctx.lastText)) {
            const delta = current.slice(ctx.lastText.length);
            if (delta) await emit({type: 'chat.delta', text: delta, revision: ++ctx.revision, page_epoch: this.pageEpoch});
          } else {
            await emit({type: 'chat.snapshot', text: current, revision: ++ctx.revision, page_epoch: this.pageEpoch});
          }
          ctx.lastText = current;
          lastProgress = stableSince = Date.now();
        }
        const stopped = !ChatGPTSelectors.stop();
        if (ctx.stopRequested && stopped) {
          await emit({type: 'chat.cancelled', revision: ctx.revision, partial_text: ctx.lastText.slice(-2000)});
          terminal = true;
          return;
        }
        if (answer && ctx.lastText && stopped && ChatGPTSelectors.completed(answer) &&
            Date.now() - stableSince >= 600) {
          await emit({type: 'chat.completed', revision: ctx.revision, url: location.href,
                      ...(await this.digest(ctx.lastText))});
          terminal = true;
          return;
        }
        if (!ctx.lastText && Date.now() > firstDeadline) throw new Error('OUTPUT_TIMEOUT: 尚未观察到本轮回答');
        if (ctx.lastText && Date.now() - lastProgress > 45000)
          throw new Error('NO_PROGRESS: 回答长时间未更新，完成状态不确定');
        await this.mutationOrTimeout(150);
      }
      throw new Error('GENERATION_TIMEOUT: 未观察到可信的完成信号');
    } catch (error) {
      if (!terminal) {
        const message = String(error.message || error);
        const code = /^[A-Z_]+:/.test(message) ? message.split(':', 1)[0] : 'PAGE_ERROR';
        await emit({type: 'chat.error', code, message, partial_text: ctx.lastText.slice(-2000),
                    submitted: ctx.submitted});
      }
    } finally {
      this.active = null;
    }
  }

  async stop(job) {
    const ctx = this.active;
    if (!ctx || (job.target_id && ctx.jobId !== job.target_id))
      throw new Error('UNKNOWN_REQUEST: 当前页面没有对应的生成任务');
    const button = ChatGPTSelectors.stop();
    if (!button) throw new Error('COMPLETION_UNCERTAIN: 页面没有可用的停止按钮');
    ctx.stopRequested = true;
    button.click();
    return {accepted: true, target_id: ctx.jobId};
  }
}
