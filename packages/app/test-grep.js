import fs from 'fs';
const dir = '../../node_modules/.bun';
function search(d) {
  if (!fs.existsSync(d)) return;
  for (const f of fs.readdirSync(d)) {
    const full = d + '/' + f;
    if (fs.statSync(full).isDirectory()) search(full);
    else if (full.endsWith('.js')) {
      const c = fs.readFileSync(full, 'utf8');
      if (c.includes('header') && c.includes('Background')) {
        const lines = c.split('\n').filter(l => l.includes('header') && l.includes('Background') || l.includes('HEADER'));
        if(lines.length > 0) {
            console.log("---- " + full);
            console.log(lines.join('\n'));
        }
      }
    }
  }
}
search(dir + '/@univerjs+engine-render@0.18.0+b0355161d01c5119/node_modules/@univerjs/engine-render/lib/es');
search(dir + '/@univerjs+sheets-ui@0.18.0+6a155b12359c3c21/node_modules/@univerjs/sheets-ui/lib/es');
