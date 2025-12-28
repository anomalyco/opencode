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
      if(!semverRegex.test(a) || !semverRegex.test(b)){
        problems.push({name,a,b,okA:semverRegex.test(a),okB:semverRegex.test(b)})
      }
    }
  }
}

if(problems.length===0) console.log('No non-strict-version pairs found')
else{
  console.log('Found pairs where at least one side is non-strict-version:')
  for(const p of problems) console.log(p.name, p.a, p.b, '->', p.okA, p.okB)
  process.exit(2)
}