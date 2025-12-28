const fs = require('fs')
const path = require('path')
const map = new Map()
function add(pkgName, version, file){
  if(!map.has(pkgName)) map.set(pkgName, new Map())
  const m = map.get(pkgName)
  m.set(version, (m.get(version)||[]).concat(file))
}
function walk(dir){
  for(const f of fs.readdirSync(dir)){
    const p = path.join(dir,f)
    if(f==='node_modules' || f==='.git' || f==='Open' || f==='Open.bak') continue
    const st = fs.statSync(p)
    if(st.isDirectory()) walk(p)
    else if(f==='package.json'){
      try{
        const j = JSON.parse(fs.readFileSync(p,'utf8'))
        const groups = ['dependencies','devDependencies','peerDependencies','optionalDependencies','overrides']
        for(const g of groups){
          const obj = j[g]
          if(obj && typeof obj === 'object'){
            for(const [name,v] of Object.entries(obj)){
              add(name, String(v), p+" ("+g+")")
            }
          }
        }
      }catch(e){ console.error('ERR',p,e.message)}
    }
  }
}
walk(process.cwd())
for(const [pkg,versions] of map){
  if(versions.size>1){
    console.log('PACKAGE',pkg)
    for(const [v,files] of versions){
      console.log('  version:',v)
      for(const f of files) console.log('    ',f)
    }
  }
}
