const fs = require('fs')
const path = require('path')
const semverRegex = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-.]+)?$/

function walk(dir, cb){
  for(const f of fs.readdirSync(dir)){
    const p = path.join(dir,f)
    if(f==='node_modules' || f==='.git' || f==='Open' || f==='Open.bak') continue
    const st = fs.statSync(p)
    if(st.isDirectory()) walk(p, cb)
    else if(f==='package.json') cb(p)
  }
}

const results = []
walk(process.cwd(), (p)=>{
  try{
    const j = JSON.parse(fs.readFileSync(p,'utf8'))
    for(const depType of ['dependencies','devDependencies','peerDependencies','optionalDependencies']){
      const deps = j[depType]
      if(!deps) continue
      for(const [name,ver] of Object.entries(deps)){
        if(!semverRegex.test(String(ver))) results.push({file:p,package:name,version:String(ver)})
      }
    }
  }catch(e){ console.error('ERR',p,e.message)}
})

if(results.length===0) console.log('All dependency versions are strict semver.')
else{
  console.log('Non-strict dependency versions (file, package, version):')
  for(const r of results) console.log(r.file, r.package, r.version)
  process.exit(2)
}