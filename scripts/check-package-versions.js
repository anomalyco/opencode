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
        function check(k,obj){
          if(obj && typeof obj==='object'){
            for(const [name,v] of Object.entries(obj)){
              if(v==null || v==='') console.log('Bad version',p,k,name,JSON.stringify(v))
              if(typeof v!=='string') continue
              if(v.trim()==='') console.log('Blank version string',p,k,name)
            }
          }
        }
        check('dependencies',j.dependencies)
        check('devDependencies',j.devDependencies)
        check('peerDependencies',j.peerDependencies)
        check('overrides',j.overrides)
      }catch(e){ console.error('ERR',p,e.message)}
    }
  }
}
walk(process.cwd())
