import fs from 'fs';
const file = '../../node_modules/.bun/@univerjs+sheets-ui@0.18.0+6a155b12359c3c21/node_modules/@univerjs/sheets-ui/lib/es/views/sheet-container/SheetContainer.js';
if (fs.existsSync(file)) {
  console.log("Found SheetContainer");
}
