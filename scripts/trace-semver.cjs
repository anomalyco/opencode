const semver = require('semver')
const OrigSemVer = semver.SemVer
function WrapSemVer(version, opts){
  try{
    return new OrigSemVer(version, opts)
  }catch(e){
    console.error('SEMVER_ERROR_VALUE:', JSON.stringify(version))
    console.error(e && e.stack)
    throw e
  }
}
WrapSemVer.prototype = OrigSemVer.prototype
semver.SemVer = WrapSemVer
// also wrap compare/equal to capture incoming
const origEq = semver.eq
semver.eq = function(a,b, loose){
  try{return origEq(a,b,loose)}catch(e){
    console.error('SEMVER_EQ_ERROR:', a, b)
    throw e
  }
}
