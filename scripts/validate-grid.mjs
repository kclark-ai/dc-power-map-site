import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const manifest=JSON.parse(fs.readFileSync('src/data/grid-manifest.json','utf8'));
let total=0;
for(const layer of manifest.layers){const raw=fs.readFileSync(`public${layer.file}`);assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),layer.sha256,`${layer.id}: reviewed checksum changed`);const data=JSON.parse(raw);assert.equal(data.type,'FeatureCollection');assert.equal(data.features.length,layer.features);assert.ok(layer.sourceDates.length===2);const ids=new Set();for(const f of data.features){assert.ok(['Polygon','MultiPolygon'].includes(f.geometry?.type));assert.ok(f.properties.name);assert.ok(f.properties.sourceDate);assert.ok(!ids.has(f.properties.id));ids.add(f.properties.id);const walk=c=>{if(typeof c[0]==='number'){assert.ok(c[0]>=-180&&c[0]<=180&&c[1]>=-90&&c[1]<=90)}else c.forEach(walk)};walk(f.geometry.coordinates);}total+=data.features.length;}
console.log(`Validated ${manifest.layers.length} dated grid snapshots, ${total} boundary records, geometry ranges and evidence checksums.`);
