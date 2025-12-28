const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const skipDirs = ['node_modules', '.git', 'dist', 'target', '.opencode', '.opendeepseek'];

function walkDir(dir, callback) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
        const filepath = path.join(dir, file.name);
        if (file.isDirectory()) {
            if (!skipDirs.includes(file.name)) {
                walkDir(filepath, callback);
            }
        } else {
            callback(filepath);
        }
    }
}

const replacements = [
    { from: /@opencode-ai\//g, to: '@opendeepseek/' }
];

let fileCount = 0;

walkDir(rootDir, (filepath) => {
    if (filepath === __filename || filepath.endsWith('.png') || filepath.endsWith('.ico') || filepath.endsWith('.icns') || filepath.endsWith('.bmp')) return;

    try {
        const buffer = fs.readFileSync(filepath);
        // Rough check if it's binary
        if (buffer.includes(0x00)) return;

        let content = buffer.toString('utf8');
        let changed = false;
        replacements.forEach(r => {
            if (r.from.test(content)) {
                content = content.replace(r.from, r.to);
                changed = true;
            }
        });

        if (changed) {
            fs.writeFileSync(filepath, content, 'utf8');
            fileCount++;
            console.log('Updated:', filepath);
        }
    } catch (err) { }
});

console.log(`\nGlobal Namespace Fix complete! Files updated: ${fileCount}`);
