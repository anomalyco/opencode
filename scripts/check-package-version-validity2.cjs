const fs = require('fs')
const path = require('path')
const semverRegex = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-.]+)?$/
function walk(dir){
  for(const f of fs.readdirSync(dir)){
    const p = path.join(dir,f)
    if(f==='node_modules' || f==='.git' || f==='Open') continue
    const st = fs.statSync(p)
    if(st.isDirectory()) walk(p)
    else if(f==='package.json'){
      try{
        const j = JSON.parse(fs.readFileSync(p,'utf8'))
        const v = j.version
        if(typeof v !== 'string') console.log('NON-STRING VERSION', p, JSON.stringify(v))
        else if(!semverRegex.test(v)) console.log('INVALID VERSION', p, v)
      }catch(e){ console.error('ERR',p,e.message)}
    }
  }
}
walk(process.cwd())
