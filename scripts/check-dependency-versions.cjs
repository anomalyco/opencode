const fs = require('fs')
const path = require('path')
function walk(dir){
  for(const f of fs.readdirSync(dir)){
    const p = path.join(dir,f)
    if(f==='node_modules' || f==='.git' || f==='Open') continue
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
              if(typeof v !== 'string') console.log('NON-STRING DEP VERSION', p, g, name, JSON.stringify(v))
              else if(v.trim() === '') console.log('EMPTY DEP VERSION', p, g, name)
              else if(/\n|\r/.test(v)) console.log('MULTILINE DEP VERSION', p, g, name, JSON.stringify(v))
            }
          }
        }
      }catch(e){ console.error('ERR',p,e.message)}
    }
  }
}
walk(process.cwd())
