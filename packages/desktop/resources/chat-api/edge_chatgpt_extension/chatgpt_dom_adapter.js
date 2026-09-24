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
      if (this.active || ChatGPTSelectors.stop()) return 'GENERATING';
      if (document.readyState !== 'complete') return 'LOADING';
      const editor = ChatGPTSelectors.editor();
      if (editor && !editor.disabled && editor.getAttribute('aria-disabled') !== 'true' &&
          editor.getAttribute('aria-busy') !== 'true') return 'READY';
    } catch { return 'DOM_CHANGED'; }
    if ([...document.querySelectorAll('a[href*="/auth/login"],a[href*="/auth/signup"]')]
        .some(ChatGPTSelectors.visible)) return 'LOGIN_REQUIRED';
    return document.readyState === 'loading' ? 'LOADING' : 'DOM_CHANGED';
  }

  health() {
    return {state: this.state(), page_epoch: this.pageEpoch, url: location.href,
            adapter_version: '0.3.2'};
  }

  async waitForReady(timeout = 25000) {
    const end = Date.now() + timeout;
    let readySince = null;
    let readyEditor = null;
    while (Date.now() < end) {
      const state = this.state();
      const editor = state === 'READY' ? ChatGPTSelectors.editor() : null;
      if (!editor || editor !== readyEditor) readySince = null;
      readyEditor = editor;
      if (editor) {
        readySince ??= Date.now();
        if (Date.now() - readySince >= 700) return;
      }
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
    // ProseMirror uses NBSP to preserve spaces at the start and end of a line.
    const expected = text.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ');
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const currentEditor = ChatGPTSelectors.editor() || editor;
      const actual = this.editorText(currentEditor).replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ');
      if (actual === expected) return;
      await this.pause(50);
    }
    throw new Error('INPUT_REJECTED: 输入内容与请求不一致');
  }

  async pasteAttachments(editor, attachments) {
    if (!Array.isArray(attachments) || !attachments.length) return;
    let totalBytes = 0;
    const files = attachments.map(attachment => {
      if (!attachment || typeof attachment.filename !== 'string' ||
          typeof attachment.mediaType !== 'string' || typeof attachment.data !== 'string')
        throw new Error('BAD_ATTACHMENT: 附件格式无效');
      let binary;
      try { binary = atob(attachment.data); }
      catch { throw new Error('BAD_ATTACHMENT: 附件数据无效'); }
      totalBytes += binary.length;
      if (totalBytes > 20 * 1024 * 1024) throw new Error('BAD_ATTACHMENT: 附件总大小不能超过 20 MB');
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      return new File([bytes], attachment.filename, {type: attachment.mediaType});
    });
    for (const [index, file] of files.entries()) {
      const currentEditor = ChatGPTSelectors.editor() || editor;
      const composer = currentEditor.closest('form') || currentEditor.parentElement?.parentElement?.parentElement;
      if (!composer) throw new Error('DOM_CHANGED: 未找到附件输入区域');
      const attachmentCount = container => [...container.querySelectorAll('*')]
        .filter(element => ChatGPTSelectors.visible(element) &&
          /remove (?:file|image)|移除(?:文件|图片)/i.test(
            `${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''}`,
          )).length;
      const previousAttachmentCount = attachmentCount(composer);
      const transfer = new DataTransfer();
      transfer.items.add(file);
      currentEditor.focus();
      currentEditor.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }));

      const expectedImages = files.slice(0, index + 1).filter(item => item.type.startsWith('image/')).length;
      const deadline = Date.now() + 120000;
      let readySince = null;
      let uploaded = false;
      while (Date.now() < deadline) {
        const activeEditor = ChatGPTSelectors.editor() || currentEditor;
        const activeComposer = activeEditor.closest('form') || activeEditor.parentElement?.parentElement?.parentElement;
        if (!activeComposer) throw new Error('DOM_CHANGED: 未找到附件输入区域');
        const elements = [...activeComposer.querySelectorAll('*')].filter(element =>
          element !== activeEditor && !activeEditor.contains(element) && !element.contains(activeEditor));
        const visible = elements.filter(element => ChatGPTSelectors.visible(element));
        const details = visible.flatMap(element => [
          element.innerText,
          element.getAttribute('aria-label'),
          element.getAttribute('title'),
          element.getAttribute('data-filename'),
          element.getAttribute('alt'),
        ]).filter(Boolean).join('\n').toLocaleLowerCase();
        if (/upload failed|failed to upload|上传失败|附件失败/.test(details))
          throw new Error('UPLOAD_FAILED: ChatGPT 附件上传失败');
        const imageCount = visible.filter(element => element.tagName === 'IMG' && element.naturalWidth > 0).length;
        const imageReady = !file.type.startsWith('image/') || imageCount >= expectedImages;
        const filenameReady = details.includes(file.name.toLocaleLowerCase());
        const attachmentReady = attachmentCount(activeComposer) > previousAttachmentCount || filenameReady;
        const send = ChatGPTSelectors.send();
        const sendReady = index !== files.length - 1 ||
          (send && !send.disabled && send.getAttribute('aria-disabled') !== 'true');
        const busy = /uploading|processing|scanning|上传中|处理中|正在上传|正在处理/.test(details) ||
          visible.some(element => element.getAttribute('aria-busy') === 'true' ||
            element.getAttribute('role') === 'progressbar' || /upload|progress|spinner/i.test(element.getAttribute('data-testid') || ''));
        if (!busy && attachmentReady && imageReady && sendReady) {
          readySince ??= Date.now();
          if (Date.now() - readySince >= 600) {
            uploaded = true;
            break;
          }
        } else {
          readySince = null;
        }
        await this.mutationOrTimeout(120);
      }
      if (!uploaded) throw new Error('UPLOAD_TIMEOUT: 等待 ChatGPT 附件上传或发送按钮就绪超时');
    }
  }

  async captureGeneratedFiles(turns) {
    const sources = turns.flatMap(turn => [
      ...[...turn.querySelectorAll('img')]
        .filter(image => ChatGPTSelectors.visible(image) && image.naturalWidth > 0)
        .map(image => ({url: image.currentSrc || image.src, filename: '', image: true})),
      ...[...turn.querySelectorAll('a[download]')]
        .filter(ChatGPTSelectors.visible)
        .map(link => ({url: link.href, filename: link.download || '', image: false})),
    ]);
    const seen = new Set();
    const files = [];
    let totalBytes = 0;
    for (const source of sources) {
      if (!source.url || seen.has(source.url)) continue;
      seen.add(source.url);
      let url;
      try { url = new URL(source.url, location.href); }
      catch { continue; }
      if (url.protocol !== 'data:' && url.origin !== location.origin) continue;
      let response;
      try { response = await fetch(url.href, {credentials: 'include'}); }
      catch { continue; }
      if (!response.ok) continue;
      const mediaType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
      if (!mediaType || mediaType === 'text/html' || (source.image && !mediaType.startsWith('image/'))) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      totalBytes += bytes.length;
      if (totalBytes > 20 * 1024 * 1024) throw new Error('ARTIFACT_TOO_LARGE: 生成文件总大小不能超过 20 MB');
      const extension = ({'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
        'image/gif': '.gif', 'image/avif': '.avif', 'application/pdf': '.pdf'})[mediaType] || '.bin';
      files.push({
        filename: source.filename || `${source.image ? 'generated-image' : 'generated-file'}-${files.length + 1}${extension}`,
        mediaType,
        data: bytesToBase64(bytes),
      });
    }
    return files;
  }

  async digest(text) {
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return {bytes: bytes.length, sha256: [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('')};
  }

  async emitTextUpdate(ctx, current, emit, force = false) {
    if (current === ctx.emittedText) return;
    const now = Date.now();
    if (!force && ctx.lastEmit && now - ctx.lastEmit < 1500) return;
    const append = current.startsWith(ctx.emittedText);
    const text = append ? current.slice(ctx.emittedText.length) : current;
    const revision = ctx.revision + 1;
    await emit({type: append ? 'chat.delta' : 'chat.snapshot', text, revision, page_epoch: this.pageEpoch});
    ctx.emittedText = current;
    ctx.lastEmit = now;
    ctx.revision = revision;
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
    const ctx = {jobId: job.id, stopRequested: false, submitted: false, lastText: '',
                 emittedText: '', lastEmit: 0, revision: 0, baseline, startURL, mediaCount: 0};
    this.active = ctx;
    let terminal = false;
    try {
      await emit({type: 'chat.accepted', page_epoch: this.pageEpoch});
      await this.fillEditor(editor, job.text);
      await this.pasteAttachments(editor, job.attachments || []);
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
      const totalDeadline = Date.now() + 450000;
      const firstDeadline = Date.now() + 60000;
      let lastProgress = Date.now();
      let stableSince = Date.now();
      let completionSince = null;
      while (Date.now() < totalDeadline) {
        if (location.pathname !== startURL && startURL !== '/' && !startURL.startsWith('/?'))
          throw new Error('SESSION_LOST: 会话页面发生切换');
        const turns = ChatGPTSelectors.turns();
        const userIndex = turns.findIndex(e => e.getAttribute('data-message-id') === userId);
        if (userIndex < 0) throw new Error('SESSION_LOST: 本轮消息已从页面消失');
        const following = turns.slice(userIndex + 1);
        if (following.some(e => e.getAttribute('data-message-author-role') === 'user'))
          throw new Error('PAGE_INTERFERED: 页面出现另一条用户消息');
        const answers = following.filter(e => e.getAttribute('data-message-author-role') === 'assistant');
        const answer = answers.at(-1);
        const current = answers.map(turn => ChatGPTSelectors.answerText(turn)).filter(Boolean).join('\n\n');
        if (current !== ctx.lastText) {
          ctx.lastText = current;
          lastProgress = stableSince = Date.now();
          await this.emitTextUpdate(ctx, current, emit);
        }
        const restriction = ChatGPTSelectors.restrictionError(answer);
        if (restriction) throw new Error('ACCOUNT_RESTRICTED: ' + restriction);
        const failure = ChatGPTSelectors.generationError(answer);
        if (failure) throw new Error('GENERATION_FAILED: ' + failure);
        const stopped = !ChatGPTSelectors.stop();
        const mediaCount = answers.reduce((count, turn) => count + ChatGPTSelectors.generatedMediaCount(turn), 0);
        if (mediaCount !== ctx.mediaCount) {
          ctx.mediaCount = mediaCount;
          lastProgress = stableSince = Date.now();
        }
        const mediaOutput = mediaCount > 0;
        const generating = ChatGPTSelectors.generating();
        const complete = answer && (ctx.lastText || mediaOutput) && stopped &&
          (ChatGPTSelectors.completed(answer) || (mediaOutput && !generating && Date.now() - stableSince >= 5000));
        completionSince = complete ? completionSince ?? Date.now() : null;
        if (ctx.stopRequested && stopped) {
          await emit({type: 'chat.cancelled', revision: ctx.revision, partial_text: ctx.lastText.slice(-2000)});
          terminal = true;
          return;
        }
        if (completionSince && Date.now() - completionSince >= 1500 &&
            Date.now() - stableSince >= 1500) {
          answers.forEach(turn => ChatGPTSelectors.validateToolText(turn));
          await this.emitTextUpdate(ctx, ctx.lastText, emit, true);
          const files = mediaOutput ? await this.captureGeneratedFiles(answers) : [];
          await emit({type: 'chat.completed', revision: ctx.revision, url: location.href,
                      files, media_output: mediaOutput, media_capture_failed: mediaOutput && files.length === 0,
                      ...(await this.digest(ctx.lastText))});
          terminal = true;
          return;
        }
        if (!ctx.lastText && Date.now() > firstDeadline && !generating && !mediaOutput)
          throw new Error('OUTPUT_TIMEOUT: 页面未显示生成状态，也未观察到本轮回答');
        if (ctx.lastText && Date.now() - lastProgress > 45000 && !generating)
          throw new Error('NO_PROGRESS: 回答长时间未更新，完成状态不确定');
        await this.mutationOrTimeout(150);
      }
      throw new Error('GENERATION_TIMEOUT: 未观察到可信的完成信号');
    } catch (error) {
      if (!terminal) {
        const message = String(error.message || error);
        const code = /^[A-Z_]+:/.test(message) ? message.split(':', 1)[0] : 'PAGE_ERROR';
        await emit({type: 'chat.error', code, message, partial_text: ctx.lastText.slice(-2000),
                    submitted: ctx.submitted, url: location.href});
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

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
