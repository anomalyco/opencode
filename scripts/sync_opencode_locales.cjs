const fs = require('fs');
const path = require('path');
const https = require('https');

const baseDir = 'C:\\Users\\Work-D\\source\\opencode';

// Helper to call Google Translate API
function translateText(text) {
  return new Promise((resolve) => {
    const trimmed = text.trim();
    if (!trimmed) return resolve(text);
    
    // Preserve placeholders like {{name}}, {count}, etc.
    const placeholders = [];
    const regex = /\{\{[^}]+\}\}|\{[^}]+\}/g;
    let masked = trimmed.replace(regex, (match) => {
      placeholders.push(match);
      return `__PH_${placeholders.length - 1}__`;
    });

    // Mask newlines
    masked = masked.replace(/\n/g, ' __NL__ ');

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&q=${encodeURIComponent(masked)}`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          let translated = parsed[0].map(x => x[0]).join('');
          
          // Restore newlines
          translated = translated.replace(/\s*__NL__\s*/gi, '\n');
          translated = translated.replace(/__NL__/gi, '\n');

          // Restore placeholders
          for (let i = 0; i < placeholders.length; i++) {
            translated = translated.replace(new RegExp(`__PH_${i}__`, 'gi'), placeholders[i]);
          }
          resolve(translated);
        } catch (e) {
          resolve(trimmed);
        }
      });
    }).on('error', () => {
      resolve(trimmed);
    });
  });
}

function parseTsDictRegex(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const regex = /"([^"]+)"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`|'((?:[^'\\]|\\.)*)')/g;
  const result = {};
  let m;
  while ((m = regex.exec(content)) !== null) {
    const key = m[1];
    let val = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
    // Unescape the string
    val = val
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    result[key] = val;
  }
  return result;
}

function getKeysInOrder(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const regex = /"([^"]+)"\s*:/g;
  const keys = [];
  let m;
  while ((m = regex.exec(content)) !== null) {
    keys.push(m[1]);
  }
  return keys;
}

async function syncTarget(relativeDir, isJson = false) {
  const dirPath = path.join(baseDir, relativeDir);
  console.log(`\nSynchronizing locale in: ${relativeDir}`);
  if (!fs.existsSync(dirPath)) {
    console.log(`  Directory does not exist, skipping.`);
    return;
  }

  let enFile;
  if (relativeDir === 'packages/stats/app/src/i18n') {
    enFile = path.join(baseDir, 'packages/stats/app/src/i18n.ts');
  } else {
    enFile = path.join(dirPath, isJson ? 'en.json' : 'en.ts');
  }
  const trFile = path.join(dirPath, isJson ? 'tr.json' : 'tr.ts');

  if (!fs.existsSync(enFile)) {
    console.log(`  English file does not exist: ${enFile}`);
    return;
  }

  let enDict = {};
  let enKeys = [];
  if (isJson) {
    enDict = JSON.parse(fs.readFileSync(enFile, 'utf8'));
    enKeys = Object.keys(enDict);
  } else {
    enDict = parseTsDictRegex(enFile);
    enKeys = getKeysInOrder(enFile);
  }

  let trDict = {};
  if (fs.existsSync(trFile)) {
    if (isJson) {
      trDict = JSON.parse(fs.readFileSync(trFile, 'utf8'));
    } else {
      trDict = parseTsDictRegex(trFile);
    }
  }

  const missingKeys = enKeys.filter(k => !trDict[k]);
  console.log(`  English keys: ${enKeys.length}`);
  console.log(`  Existing Turkish keys: ${Object.keys(trDict).length}`);
  console.log(`  Missing Turkish keys: ${missingKeys.length}`);

  if (missingKeys.length > 0) {
    for (const key of missingKeys) {
      const enVal = enDict[key];
      if (enVal === undefined) {
        console.log(`    [WARN] Key "${key}" value is undefined in English dict!`);
        trDict[key] = '';
        continue;
      }
      console.log(`    Translating key: "${key}" -> "${enVal}"`);
      const trVal = await translateText(enVal);
      trDict[key] = trVal;
    }
  }

  // Write file preserving order and correct structure
  if (isJson) {
    const sortedTr = {};
    for (const key of enKeys) {
      sortedTr[key] = trDict[key] || enDict[key];
    }
    fs.writeFileSync(trFile, JSON.stringify(sortedTr, null, 2), 'utf8');
    console.log(`  [OK] Saved ${trFile}`);
  } else {
    let outContent = '';
    
    // Choose headers/footers based on folder path
    if (relativeDir.includes('packages/app/src/i18n') || relativeDir.includes('packages/ui/src/i18n')) {
      outContent += `import { dict as en } from "./en"\n\ntype Keys = keyof typeof en\n\nexport const dict = {\n`;
      for (const key of enKeys) {
        const trVal = trDict[key] || enDict[key];
        const escapedVal = trVal.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
        outContent += `  "${key}": "${escapedVal}",\n`;
      }
      outContent += `} satisfies Partial<Record<Keys, string>>\n`;
    } else if (relativeDir.includes('packages/console/app/src/i18n')) {
      outContent += `import type { Dict } from "./en"\nimport { dict as en } from "./en"\n\nexport const dict = {\n`;
      for (const key of enKeys) {
        const trVal = trDict[key] || enDict[key];
        const escapedVal = trVal.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
        outContent += `  "${key}": "${escapedVal}",\n`;
      }
      outContent += `} satisfies Dict\n`;
    } else if (relativeDir.includes('packages/desktop/src/renderer/i18n')) {
      outContent += `export const dict = {\n`;
      for (const key of enKeys) {
        const trVal = trDict[key] || enDict[key];
        const escapedVal = trVal.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
        outContent += `  "${key}": "${escapedVal}",\n`;
      }
      outContent += `}\n`;
    } else if (relativeDir.includes('packages/stats/app/src/i18n')) {
      outContent += `export const dict = {\n`;
      for (const key of enKeys) {
        const trVal = trDict[key] || enDict[key];
        const escapedVal = trVal.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
        outContent += `  "${key}": "${escapedVal}",\n`;
      }
      outContent += `} as const\n`;
    } else {
      // General fallback
      outContent += `export const dict = {\n`;
      for (const key of enKeys) {
        const trVal = trDict[key] || enDict[key];
        const escapedVal = trVal.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
        outContent += `  "${key}": "${escapedVal}",\n`;
      }
      outContent += `}\n`;
    }
    
    fs.writeFileSync(trFile, outContent, 'utf8');
    console.log(`  [OK] Saved ${trFile}`);
  }
}

async function run() {
  await syncTarget('packages/app/src/i18n', false);
  await syncTarget('packages/console/app/src/i18n', false);
  await syncTarget('packages/desktop/src/renderer/i18n', false);
  await syncTarget('packages/ui/src/i18n', false);
  await syncTarget('packages/web/src/content/i18n', true);
  await syncTarget('packages/stats/app/src/i18n', false);
  console.log('\n=== Synchronization Completed Successfully! ===');
}

run();
