const Module = require('module')
const fs = require('fs')
const path = require('path')
const logPath = path.join(process.cwd(),'semver-fail.log')
const origReq = Module.prototype.require
Module.prototype.require = function(p){
  const mod = origReq.apply(this, arguments)
  try{
    if(p === 'semver' || p === 'semver/'){ // intercept semver
      if(mod && mod.classes && mod.classes.SemVer){
        const OrigSemVer = mod.classes.SemVer
        if(OrigSemVer.__wrapped) return mod
        function WrappedSemVer(v, opts){
          try{ return new OrigSemVer(v, opts) }
          catch(e){
            const msg = `SEMVER_FAIL: ${String(v)}\nSTACK: ${e.stack}\n` + new Date().toISOString() + '\n'
            try{ fs.appendFileSync(logPath, msg) }catch(_){}
            throw e
          }
        }
        WrappedSemVer.__wrapped = true
        Object.setPrototypeOf(WrappedSemVer, OrigSemVer)
        mod.classes.SemVer = WrappedSemVer
      }
    }
  }catch(e){}
  return mod
}

// also try to wrap pre-existing semver module cached entries
try{
  const semverPath = require.resolve('semver')
  const cached = require.cache[semverPath]
  if(cached && cached.exports && cached.exports.classes && cached.exports.classes.SemVer){
    const OrigSemVer = cached.exports.classes.SemVer
    function WrappedSemVer(v, opts){
      try{ return new OrigSemVer(v, opts) }
      catch(e){
        const msg = `SEMVER_FAIL: ${String(v)}\nSTACK: ${e.stack}\n` + new Date().toISOString() + '\n'
        try{ fs.appendFileSync(logPath, msg) }catch(_){}
        throw e
      }
    }
    WrappedSemVer.__wrapped = true
    Object.setPrototypeOf(WrappedSemVer, OrigSemVer)
    cached.exports.classes.SemVer = WrappedSemVer
  }
}catch(e){}
