const fs = require('fs')
const path = require('path')

function walk(dir, cb){
  for(const f of fs.readdirSync(dir)){
    const p = path.join(dir,f)
    const st = fs.statSync(p)
    if(st.isDirectory()){
      if(f==='node_modules' || f==='.git' || f==='Open' || f==='Open.bak') continue
      walk(p,cb)
    } else if(/\.ts$|\.tsx$/.test(f)){
      cb(p)
    }
  }
}

const imports = new Set()
walk(process.cwd(), (p)=>{
  const s = fs.readFileSync(p,'utf8')
  const re = /import\s+[^'"]+['"](.+?\.txt)['"]/g
  let m
  while((m = re.exec(s))){
    imports.add(path.resolve(path.dirname(p), m[1]))
  }
  const re2 = /import\s+['"](.+?\.txt)['"]/g
  while((m = re2.exec(s))){
    imports.add(path.resolve(path.dirname(p), m[1]))
  }
})

let created = 0
for(const file of imports){
  try{
    if(!fs.existsSync(file)){
      console.error('Missing txt file', file)
      continue
    }
    const content = fs.readFileSync(file,'utf8')
    const outFile = file + '.mjs'
    const moduleSource = `export default ${JSON.stringify(content)};\n`
    if(!fs.existsSync(outFile) || fs.readFileSync(outFile,'utf8') !== moduleSource){
      fs.writeFileSync(outFile, moduleSource)
      created++
    }
  }catch(e){ console.error('ERR',file,e.message)}
}

// Now replace import paths in source files
let replaced = 0
walk(process.cwd(), (p)=>{
  let s = fs.readFileSync(p,'utf8')
  const newS = s.replace(/(import\s+[^'";]+['"])(.+?\.txt)(['"])/g, (m,a,b,c)=>{
    const res = a + b + '.mjs' + c
    if(res !== m) replaced++
    return res
  }).replace(/(import\s+['"])(.+?\.txt)(['"])/g, (m,a,b,c)=>{
    const res = a + b + '.mjs' + c
    if(res !== m) replaced++
    return res
  })
  if(newS !== s){ fs.writeFileSync(p,newS,'utf8') }
})

console.log('created',created,'replaced',replaced)
