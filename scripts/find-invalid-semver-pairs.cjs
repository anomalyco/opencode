const fs = require('fs')
const path = require('path')
const semver = require('semver')

function walk(dir, cb){
  for(const f of fs.readdirSync(dir)){
    const p = path.join(dir,f)
    if(f==='node_modules' || f==='.git' || f==='Open' || f==='Open.bak') continue
    const st = fs.statSync(p)
    if(st.isDirectory()) walk(p, cb)
    else if(f==='package.json') cb(p)
  }
}

const map = new Map()
walk(process.cwd(), (p)=>{
  try{
    const j = JSON.parse(fs.readFileSync(p,'utf8'))
    for(const depType of ['dependencies','devDependencies','peerDependencies','optionalDependencies']){
      const deps = j[depType]
      if(!deps) continue
      for(const [name,ver] of Object.entries(deps)){
        if(!map.has(name)) map.set(name, new Set())
        map.get(name).add(String(ver))
      }
    }
  }catch(e){ console.error('ERR',p,e.message)}
})

let problems = []
for(const [name,vers] of map.entries()){
  const arr = Array.from(vers)
  if(arr.length<=1) continue
  for(let i=0;i<arr.length;i++){
    for(let j=i+1;j<arr.length;j++){
      const a = arr[i], b = arr[j]
      try{
        semver.eq(a,b)
      }catch(e){
        problems.push({name,a,b,error:e.message})
      }
    }
  }
}

if(problems.length===0) console.log('No invalid semver pairs found')
else{
  console.log('Found invalid semver comparisons:')
  for(const p of problems) console.log(p.name, p.a, p.b, '->', p.error)
  process.exit(2)
}