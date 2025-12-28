const fs = require('fs')
const path = require('path')

const allowedPrefixes = ['^','~','>=','<=','>','<']
const allowedStarts = ['file:','workspace:','git+','http:','https:']
const semverStrict = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-.]+)?$/
const semverWithPrefix = /^(?:\^|~|>=|<=|>|<)?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-.]+)?$/

function walk(dir, cb){
  for(const f of fs.readdirSync(dir)){
    const p = path.join(dir,f)
    if(f==='node_modules' || f==='.git' || f==='Open' || f==='Open.bak') continue
    const st = fs.statSync(p)
    if(st.isDirectory()) walk(p, cb)
    else if(f==='package.json') cb(p)
  }
}

const problems = []
walk(process.cwd(), (p)=>{
  try{
    const j = JSON.parse(fs.readFileSync(p,'utf8'))
    for(const depType of ['dependencies','devDependencies','peerDependencies','optionalDependencies']){
      const deps = j[depType]
      if(!deps) continue
      for(const [name,ver] of Object.entries(deps)){
        const s = String(ver)
        if(s==='*') continue
        if(semverStrict.test(s)) continue
        if(semverWithPrefix.test(s)) continue
        if(allowedStarts.some(x=>s.startsWith(x))) continue
        // allow workspace references like "@scope/*"? we treat file variants above
        // Flag other oddities
        if(/\s/.test(s) || s.includes(',') || s.includes('{') || s.includes('}') ){
          problems.push({pkg:p, name, ver:s, reason:'contains invalid chars'})
        } else if(!(/[0-9]/.test(s))) {
          problems.push({pkg:p, name, ver:s, reason:'no digits'})
        } else {
          problems.push({pkg:p, name, ver:s, reason:'unknown format'})
        }
      }
    }
  }catch(e){ console.error('ERR',p,e.message)}
})

if(problems.length===0) console.log('No weird version strings found')
else{
  console.log('Found weird version strings:')
  for(const p of problems) console.log(p.pkg, p.name, p.ver, '->', p.reason)
  process.exit(2)
}