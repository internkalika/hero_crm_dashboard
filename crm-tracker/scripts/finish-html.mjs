// Copies the single-file build to its final, shareable name.
import fs from 'node:fs';
const from = new URL('../dist-single/index.html', import.meta.url);
const to = new URL('../CRM_Tracker_Dashboard.html', import.meta.url);
fs.copyFileSync(from, to);
console.log(`CRM_Tracker_Dashboard.html written (${(fs.statSync(to).size / 1e6).toFixed(1)} MB)`);
