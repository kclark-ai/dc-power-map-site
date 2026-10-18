import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const audit=JSON.parse(readFileSync('public/evidence-audit.json','utf8'));
for(const [path,hash] of Object.entries(audit.checksums))assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),hash,`Stale evidence snapshot: ${path}; run node scripts/audit-data.mjs after review`);
console.log('Evidence checksums match the reviewed data snapshot.');
const index=JSON.parse(readFileSync('src/data/watershed-index.json','utf8'));
const boundaries=JSON.parse(readFileSync('public/watersheds.json','utf8'));
for(const f of boundaries.features)assert.ok(index[f.properties.recordId]?.includes(`${f.properties.name} ${f.properties.huc}`),'Watershed search index is stale');
