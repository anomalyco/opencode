'use strict'
const proc =
  typeof process === 'object' && process
    ? process
    : {
        stdout: null,
        stderr: null,
      }
const EE = require('events')
const Stream = require('stream')
const stringdecoder = require('string_decoder')
const SD = stringdecoder.StringDecoder

const EOF = Symbol('EOF')
const MAYBE_EMIT_END = Symbol('maybeEmitEnd')
const EMITTED_END = Symbol('emittedEnd')
const EMITTING_END = Symbol('emittingEnd')
const EMITTED_ERROR = Symbol('emittedError')
const CLOSED = Symbol('closed')
const READ = Symbol('read')
const FLUSH = Symbol('flush')
const FLUSHCHUNK = Symbol('flushChunk')
const ENCODING = Symbol('encoding')
const DECODER = Symbol('decoder')
const FLOWING = Symbol('flowing')
const PAUSED = Symbol('paused')
const RESUME = Symbol('resume')
const BUFFER = Symbol('buffer')
const PIPES = Symbol('pipes')
const BUFFERLENGTH = Symbol('bufferLength')
const BUFFERPUSH = Symbol('bufferPush')
const BUFFERSHIFT = Symbol('bufferShift')
const OBJECTMODE = Symbol('objectMode')
// internal event when stream is destroyed
const DESTROYED = Symbol('destroyed')
// internal event when stream has an error
const ERROR = Symbol('error')
const EMITDATA = Symbol('emitData')
const EMITEND = Symbol('emitEnd')
const EMITEND2 = Symbol('emitEnd2')
const ASYNC = Symbol('async')
const ABORT = Symbol('abort')
const ABORTED = Symbol('aborted')
const SIGNAL = Symbol('signal')

const defer = fn => Promise.resolve().then(fn)

// TODO remove when Node v8 support drops
const doIter = global._MP_NO_ITERATOR_SYMBOLS_ !== '1'
const ASYNCITERATOR =
  (doIter && Symbol.asyncIterator) || Symbol('asyncIterator not implemented')
const ITERATOR =
  (doIter && Symbol.iterator) || Symbol('iterator not implemented')

// events that mean 'the stream is over'
// these are treated specially, and re-emitted
// if they are listened for after emitting.
const isEndish = ev => ev === 'end' || ev === 'finish' || ev === 'prefinish'

const isArrayBuffer = b =>
  b instanceof ArrayBuffer ||
  (typeof b === 'object' &&
    b.constructor &&
    b.constructor.name === 'ArrayBuffer' &&
    b.byteLength >= 0)

const isArrayBufferView = b => !Buffer.isBuffer(b) && ArrayBuffer.isView(b)

class Pipe {
  constructor(src, dest, opts) {
    this.src = src
    this.dest = dest
    this.opts = opts
    this.ondrain = () => src[RESUME]()
    dest.on('drain', this.ondrain)
  }
  unpipe() {
    this.dest.removeListener('drain', this.ondrain)
  }
  // istanbul ignore next - only here for the prototype
  proxyErrors() {}
  end() {
    this.unpipe()
    if (this.opts.end) this.dest.end()
  }
}

class PipeProxyErrors extends Pipe {
  unpipe() {
    this.src.removeListener('error', this.proxyErrors)
    super.unpipe()
  }
  constructor(src, dest, opts) {
    super(src, dest, opts)
    this.proxyErrors = er => dest.emit('error', er)
    src.on('error', this.proxyErrors)
  }
}

class Minipass extends Stream {
  constructor(options) {
    super()
    this[FLOWING] = false
    // whether we're explicitly paused
    this[PAUSED] = false
    this[PIPES] = []
    this[BUFFER] = []
    this[OBJECTMODE] = (options && options.objectMode) || false
    if (this[OBJECTMODE]) this[ENCODING] = null
    else this[ENCODING] = (options && options.encoding) || null
    if (this[ENCODING] === 'buffer') this[ENCODING] = null
    this[ASYNC] = (options && !!options.async) || false
    this[DECODER] = this[ENCODING] ? new SD(this[ENCODING]) : null
    this[EOF] = false
    this[EMITTED_END] = false
    this[EMITTING_END] = false
    this[CLOSED] = false
    this[EMITTED_ERROR] = null
    this.writable = true
    this.readable = true
    this[BUFFERLENGTH] = 0
    this[DESTROYED] = false
    if (options && options.debugExposeBuffer === true) {
      Object.defineProperty(this, 'buffer', { get: () => this[BUFFER] })
    }
    if (options && options.debugExposePipes === true) {
      Object.defineProperty(this, 'pipes', { get: () => this[PIPES] })
    }
    this[SIGNAL] = options && options.signal
    this[ABORTED] = false
    if (this[SIGNAL]) {
      this[SIGNAL].addEventListener('abort', () => this[ABORT]())
      if (this[SIGNAL].aborted) {
        this[ABORT]()
      }
    }
  }

  get bufferLength() {
    return this[BUFFERLENGTH]
  }

  get encoding() {
    return this[ENCODING]
  }
  set encoding(enc) {
    if (this[OBJECTMODE]) throw new Error('cannot set encoding in objectMode')

    if (
      this[ENCODING] &&
      enc !== this[ENCODING] &&
      ((this[DECODER] && this[DECODER].lastNeed) || this[BUFFERLENGTH])
    )
      throw new Error('cannot change encoding')

    if (this[ENCODING] !== enc) {
      this[DECODER] = enc ? new SD(enc) : null
      if (this[BUFFER].length)
        this[BUFFER] = this[BUFFER].map(chunk => this[DECODER].write(chunk))
    }

    this[ENCODING] = enc
  }

  setEncoding(enc) {
    this.encoding = enc
  }

  get objectMode() {
    return this[OBJECTMODE]
  }
  set objectMode(om) {
    this[OBJECTMODE] = this[OBJECTMODE] || !!om
  }

  get ['async']() {
    return this[ASYNC]
  }
  set ['async'](a) {
    this[ASYNC] = this[ASYNC] || !!a
  }

  // drop everything and get out of the flow completely
  [ABORT]() {
    this[ABORTED] = true
    this.emit('abort', this[SIGNAL].reason)
    this.destroy(this[SIGNAL].reason)
  }

  get aborted() {
    return this[ABORTED]
  }
  set aborted(_) {}

  write(chunk, encoding, cb) {
    if (this[ABORTED]) return false
    if (this[EOF]) throw new Error('write after end')

    if (this[DESTROYED]) {
      this.emit(
        'error',
        Object.assign(
          new Error('Cannot call write after a stream was destroyed'),
          { code: 'ERR_STREAM_DESTROYED' }
        )
      )
      return true
    }

    if (typeof encoding === 'function') (cb = encoding), (encoding = 'utf8')

    if (!encoding) encoding = 'utf8'

    const fn = this[ASYNC] ? defer : f => f()

    // convert array buffers and typed array views into buffers
    // at some point in the future, we may want to do the opposite!
    // leave strings and buffers as-is
    // anything else switches us into object mode
    if (!this[OBJECTMODE] && !Buffer.isBuffer(chunk)) {
      if (isArrayBufferView(chunk))
        chunk = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      else if (isArrayBuffer(chunk)) chunk = Buffer.from(chunk)
      else if (typeof chunk !== 'string')
        // use the setter so we throw if we have encoding set
        this.objectMode = true
    }

    // handle object mode up front, since it's simpler
    // this yields better performance, fewer checks later.
    if (this[OBJECTMODE]) {
      /* istanbul ignore if - maybe impossible? */
      if (this.flowing && this[BUFFERLENGTH] !== 0) this[FLUSH](true)

      if (this.flowing) this.emit('data', chunk)
      else this[BUFFERPUSH](chunk)

      if (this[BUFFERLENGTH] !== 0) this.emit('readable')

      if (cb) fn(cb)

      return this.flowing
    }

    // at this point the chunk is a buffer or string
    // don't buffer it up or send it to the decoder
    if (!chunk.length) {
      if (this[BUFFERLENGTH] !== 0) this.emit('readable')
      if (cb) fn(cb)
      return this.flowing
    }

    // fast-path writing strings of same encoding to a stream with
    // an empty buffer, skipping the buffer/decoder dance
    if (
      typeof chunk === 'string' &&
      // unless it is a string already ready for us to use
      !(encoding === this[ENCODING] && !this[DECODER].lastNeed)
    ) {
      chunk = Buffer.from(chunk, encoding)
    }

    if (Buffer.isBuffer(chunk) && this[ENCODING])
      chunk = this[DECODER].write(chunk)

    // Note: flushing CAN potentially switch us into not-flowing mode
    if (this.flowing && this[BUFFERLENGTH] !== 0) this[FLUSH](true)

    if (this.flowing) this.emit('data', chunk)
    else this[BUFFERPUSH](chunk)

    if (this[BUFFERLENGTH] !== 0) this.emit('readable')

    if (cb) fn(cb)

    return this.flowing
  }

  read(n) {
    if (this[DESTROYED]) return null

    if (this[BUFFERLENGTH] === 0 || n === 0 || n > this[BUFFERLENGTH]) {
      this[MAYBE_EMIT_END]()
      return null
    }

    if (this[OBJECTMODE]) n = null

    if (this[BUFFER].length > 1 && !this[OBJECTMODE]) {
      if (this.encoding) this[BUFFER] = [this[BUFFER].join('')]
      else this[BUFFER] = [Buffer.concat(this[BUFFER], this[BUFFERLENGTH])]
    }

    const ret = this[READ](n || null, this[BUFFER][0])
    this[MAYBE_EMIT_END]()
    return ret
  }

  [READ](n, chunk) {
    if (n === chunk.length || n === null) this[BUFFERSHIFT]()
    else {
      this[BUFFER][0] = chunk.slice(n)
      chunk = chunk.slice(0, n)
      this[BUFFERLENGTH] -= n
    }

    this.emit('data', chunk)

    if (!this[BUFFER].length && !this[EOF]) this.emit('drain')

    return chunk
  }

  end(chunk, encoding, cb) {
    if (typeof chunk === 'function') (cb = chunk), (chunk = null)
    if (typeof encoding === 'function') (cb = encoding), (encoding = 'utf8')
    if (chunk) this.write(chunk, encoding)
    if (cb) this.once('end', cb)
    this[EOF] = true
    this.writable = false

    // if we haven't written anything, then go ahead and emit,
    // even if we're not reading.
    // we'll re-emit if a new 'end' listener is added anyway.
    // This makes MP more suitable to write-only use cases.
    if (this.flowing || !this[PAUSED]) this[MAYBE_EMIT_END]()
    return this
  }

  // don't let the internal resume be overwritten
  [RESUME]() {
    if (this[DESTROYED]) return

    this[PAUSED] = false
    this[FLOWING] = true
    this.emit('resume')
    if (this[BUFFER].length) this[FLUSH]()
    else if (this[EOF]) this[MAYBE_EMIT_END]()
    else this.emit('drain')
  }

  resume() {
    return this[RESUME]()
  }

  pause() {
    this[FLOWING] = false
    this[PAUSED] = true
  }

  get destroyed() {
    return this[DESTROYED]
  }

  get flowing() {
    return this[FLOWING]
  }

  get paused() {
    return this[PAUSED]
  }

  [BUFFERPUSH](chunk) {
    if (this[OBJECTMODE]) this[BUFFERLENGTH] += 1
    else this[BUFFERLENGTH] += chunk.length
    this[BUFFER].push(chunk)
  }

  [BUFFERSHIFT]() {
    if (this[OBJECTMODE]) this[BUFFERLENGTH] -= 1
    else this[BUFFERLENGTH] -= this[BUFFER][0].length
    return this[BUFFER].shift()
  }

  [FLUSH](noDrain) {
    do {} while (this[FLUSHCHUNK](this[BUFFERSHIFT]()) && this[BUFFER].length)

    if (!noDrain && !this[BUFFER].length && !this[EOF]) this.emit('drain')
  }

  [FLUSHCHUNK](chunk) {
    this.emit('data', chunk)
    return this.flowing
  }

  pipe(dest, opts) {
    if (this[DESTROYED]) return

    const ended = this[EMITTED_END]
    opts = opts || {}
    if (dest === proc.stdout || dest === proc.stderr) opts.end = false
    else opts.end = opts.end !== false
    opts.proxyErrors = !!opts.proxyErrors

    // piping an ended stream ends immediately
    if (ended) {
      if (opts.end) dest.end()
    } else {
      this[PIPES].push(
        !opts.proxyErrors
          ? new Pipe(this, dest, opts)
          : new PipeProxyErrors(this, dest, opts)
      )
      if (this[ASYNC]) defer(() => this[RESUME]())
      else this[RESUME]()
    }

    return dest
  }

  unpipe(dest) {
    const p = this[PIPES].find(p => p.dest === dest)
    if (p) {
      this[PIPES].splice(this[PIPES].indexOf(p), 1)
      p.unpipe()
    }
  }

  addListener(ev, fn) {
    return this.on(ev, fn)
  }

  on(ev, fn) {
    const ret = super.on(ev, fn)
    if (ev === 'data' && !this[PIPES].length && !this.flowing) this[RESUME]()
    else if (ev === 'readable' && this[BUFFERLENGTH] !== 0)
      super.emit('readable')
    else if (isEndish(ev) && this[EMITTED_END]) {
      super.emit(ev)
      this.removeAllListeners(ev)
    } else if (ev === 'error' && this[EMITTED_ERROR]) {
      if (this[ASYNC]) defer(() => fn.call(this, this[EMITTED_ERROR]))
      else fn.call(this, this[EMITTED_ERROR])
    }
    return ret
  }

  get emittedEnd() {
    return this[EMITTED_END]
  }

  [MAYBE_EMIT_END]() {
    if (
      !this[EMITTING_END] &&
      !this[EMITTED_END] &&
      !this[DESTROYED] &&
      this[BUFFER].length === 0 &&
      this[EOF]
    ) {
      this[EMITTING_END] = true
      this.emit('end')
      this.emit('prefinish')
      this.emit('finish')
      if (this[CLOSED]) this.emit('close')
      this[EMITTING_END] = false
    }
  }

  emit(ev, data, ...extra) {
    // error and close are only events allowed after calling destroy()
    if (ev !== 'error' && ev !== 'close' && ev !== DESTROYED && this[DESTROYED])
      return
    else if (ev === 'data') {
      return !this[OBJECTMODE] && !data
        ? false
        : this[ASYNC]
        ? defer(() => this[EMITDATA](data))
        : this[EMITDATA](data)
    } else if (ev === 'end') {
      return this[EMITEND]()
    } else if (ev === 'close') {
      this[CLOSED] = true
      // don't emit close before 'end' and 'finish'
      if (!this[EMITTED_END] && !this[DESTROYED]) return
      const ret = super.emit('close')
      this.removeAllListeners('close')
      return ret
    } else if (ev === 'error') {
      this[EMITTED_ERROR] = data
      super.emit(ERROR, data)
      const ret =
        !this[SIGNAL] || this.listeners('error').length
          ? super.emit('error', data)
          : false
      this[MAYBE_EMIT_END]()
      return ret
    } else if (ev === 'resume') {
      const ret = super.emit('resume')
      this[MAYBE_EMIT_END]()
      return ret
    } else if (ev === 'finish' || ev === 'prefinish') {
      const ret = super.emit(ev)
      this.removeAllListeners(ev)
      return ret
    }

    // Some other unknown event
    const ret = super.emit(ev, data, ...extra)
    this[MAYBE_EMIT_END]()
    return ret
  }

  [EMITDATA](data) {
    for (const p of this[PIPES]) {
      if (p.dest.write(data) === false) this.pause()
    }
    const ret = super.emit('data', data)
    this[MAYBE_EMIT_END]()
    return ret
  }

  [EMITEND]() {
    if (this[EMITTED_END]) return

    this[EMITTED_END] = true
    this.readable = false
    if (this[ASYNC]) defer(() => this[EMITEND2]())
    else this[EMITEND2]()
  }

  [EMITEND2]() {
    if (this[DECODER]) {
      const data = this[DECODER].end()
      if (data) {
        for (const p of this[PIPES]) {
          p.dest.write(data)
        }
        super.emit('data', data)
      }
    }

    for (const p of this[PIPES]) {
      p.end()
    }
    const ret = super.emit('end')
    this.removeAllListeners('end')
    return ret
  }

  // const all = await stream.collect()
  collect() {
    const buf = []
    if (!this[OBJECTMODE]) buf.dataLength = 0
    // set the promise first, in case an error is raised
    // by triggering the flow here.
    const p = this.promise()
    this.on('data', c => {
      buf.push(c)
      if (!this[OBJECTMODE]) buf.dataLength += c.length
    })
    return p.then(() => buf)
  }

  // const data = await stream.concat()
  concat() {
    return this[OBJECTMODE]
      ? Promise.reject(new Error('cannot concat in objectMode'))
      : this.collect().then(buf =>
          this[OBJECTMODE]
            ? Promise.reject(new Error('cannot concat in objectMode'))
            : this[ENCODING]
            ? buf.join('')
            : Buffer.concat(buf, buf.dataLength)
        )
  }

  // stream.promise().then(() => done, er => emitted error)
  promise() {
    return new Promise((resolve, reject) => {
      this.on(DESTROYED, () => reject(new Error('stream destroyed')))
      this.on('error', er => reject(er))
      this.on('end', () => resolve())
    })
  }

  // for await (let chunk of stream)
  [ASYNCITERATOR]() {
    let stopped = false
    const stop = () => {
      this.pause()
      stopped = true
      return Promise.resolve({ done: true })
    }
    const next = () => {
      if (stopped) return stop()
      const res = this.read()
      if (res !== null) return Promise.resolve({ done: false, value: res })

      if (this[EOF]) return stop()

      let resolve = null
      let reject = null
      const onerr = er => {
        this.removeListener('data', ondata)
        this.removeListener('end', onend)
        this.removeListener(DESTROYED, ondestroy)
        stop()
        reject(er)
      }
      const ondata = value => {
        this.removeListener('error', onerr)
        this.removeListener('end', onend)
        this.removeListener(DESTROYED, ondestroy)
        this.pause()
        resolve({ value: value, done: !!this[EOF] })
      }
      const onend = () => {
        this.removeListener('error', onerr)
        this.removeListener('data', ondata)
        this.removeListener(DESTROYED, ondestroy)
        stop()
        resolve({ done: true })
      }
      const ondestroy = () => onerr(new Error('stream destroyed'))
      return new Promise((res, rej) => {
        reject = rej
        resolve = res
        this.once(DESTROYED, ondestroy)
        this.once('error', onerr)
        this.once('end', onend)
        this.once('data', ondata)
      })
    }

    return {
      next,
      throw: stop,
      return: stop,
      [ASYNCITERATOR]() {
        return this
      },
    }
  }

  // for (let chunk of stream)
  [ITERATOR]() {
    let stopped = false
    const stop = () => {
      this.pause()
      this.removeListener(ERROR, stop)
      this.removeListener(DESTROYED, stop)
      this.removeListener('end', stop)
      stopped = true
      return { done: true }
    }

    const next = () => {
      if (stopped) return stop()
      const value = this.read()
      return value === null ? stop() : { value }
    }
    this.once('end', stop)
    this.once(ERROR, stop)
    this.once(DESTROYED, stop)

    return {
      next,
      throw: stop,
      return: stop,
      [ITERATOR]() {
        return this
      },
    }
  }

  destroy(er) {
    if (this[DESTROYED]) {
      if (er) this.emit('error', er)
      else this.emit(DESTROYED)
      return this
    }

    this[DESTROYED] = true

    // throw away all buffered data, it's never coming out
    this[BUFFER].length = 0
    this[BUFFERLENGTH] = 0

    if (typeof this.close === 'function' && !this[CLOSED]) this.close()

    if (er) this.emit('error', er)
    // if no error to emit, still reject pending promises
    else this.emit(DESTROYED)

    return this
  }

  static isStream(s) {
    return (
      !!s &&
      (s instanceof Minipass ||
        s instanceof Stream ||
        (s instanceof EE &&
          // readable
          (typeof s.pipe === 'function' ||
            // writable
            (typeof s.write === 'function' && typeof s.end === 'function'))))
    )
  }
}

module.exports = Minipass
