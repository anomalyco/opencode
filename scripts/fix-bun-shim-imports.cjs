const fs = require('fs')
const path = require('path')

function walk(dir, cb){
  for(const f of fs.readdirSync(dir)){
    const p = path.join(dir,f)
    const st = fs.statSync(p)
    if(st.isDirectory()){
      if(f==='node_modules' || f==='.git' || f==='Open' || f==='Open.bak') continue
      walk(p,cb)
    } else if(/\.ts$/.test(f) || /\.tsx$/.test(f) || /\.js$/.test(f)){
      cb(p)
    }
  }
}

const root = process.cwd()
const target = path.join(root,'scripts','bun-shim')
let changed = 0
walk(root, (p)=>{
  const src = fs.readFileSync(p,'utf8')
  const re1 = /from\s+['"](\.{2}\/)*(scripts\/bun-shim)['"]/g
  const re2 = /import\s+['"](\.{2}\/)*(scripts\/bun-shim)['"]/g
  let out = src.replace(re1, (m)=>{
    const fileDir = path.dirname(p)
    let rel = path.relative(fileDir, target)
    // ensure posix separators for import
    rel = rel.split(path.sep).join('/')
    if(!rel.startsWith('.')) rel = './'+rel
    return `from '${rel}'`
  })
  out = out.replace(re2, (m)=>{
    const fileDir = path.dirname(p)
    let rel = path.relative(fileDir, target)
    rel = rel.split(path.sep).join('/')
    if(!rel.startsWith('.')) rel = './'+rel
    return `import '${rel}'`
  })
  if(out!==src){
    fs.writeFileSync(p,out,'utf8')
    changed++
  }
})
console.log('files changed',changed)
