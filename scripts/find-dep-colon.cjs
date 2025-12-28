const fs=require('fs'),path=require('path')
function walk(dir){
  for(const f of fs.readdirSync(dir)){
    const p=path.join(dir,f)
    if(f==='node_modules' || f==='.git' || f==='Open' || f==='Open.bak') continue
    const st=fs.statSync(p)
    if(st.isDirectory()) walk(p)
    else if(f==='package.json'){
      try{
        const j=JSON.parse(fs.readFileSync(p,'utf8'))
        const groups=['dependencies','devDependencies','peerDependencies','optionalDependencies','overrides']
        for(const g of groups){
          const obj=j[g]
          if(obj&&typeof obj==='object'){
            for(const [name,v] of Object.entries(obj)){
              if(typeof v==='string' && v.includes(':')) console.log(p,g,name,v)
            }
          }
        }
      }catch(e){console.error('ERR',p,e.message)}
    }
  }
}
walk(process.cwd())
