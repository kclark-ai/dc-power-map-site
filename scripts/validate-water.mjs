import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const report=JSON.parse(readFileSync(new URL('../src/data/water-disclosures.json',import.meta.url)));
const inventory=JSON.parse(readFileSync(new URL('../public/datacenters.json',import.meta.url)));
const ids=new Set(inventory.data.map(d=>d.id));
const mapped=new Set();
assert.equal(report.records.length,26);
assert.equal(new Set(report.records.map(r=>r.id)).size,26);
for(const r of report.records){
 assert.equal(r.year,2025);
 assert.ok(r.withdrawalMillionGallons>=r.consumptionMillionGallons);
 assert.ok(r.consumptionMillionGallons>=0);
 assert.ok(!r.sourceDescription || r.sourceUrl?.startsWith('https://'));
 for(const id of r.facilityIds){assert.ok(ids.has(id),`Missing facility ${id}`);assert.ok(!mapped.has(id),`Ambiguous disclosure ${id}`);mapped.add(id);}
}
const dalles=report.records.find(r=>r.id==='the-dalles-or');
assert.equal(dalles.consumptionMillionGallons,469);
assert.equal(Math.round(dalles.consumptionMillionGallons*1e6/365),1284932);
const douglas=report.records.find(r=>r.id==='douglas-county-ga');
assert.equal(douglas.withdrawalMillionGallons,440.6);
console.log(`Validated ${report.records.length} disclosure records, annual-average arithmetic, and ${mapped.size} unique facility associations.`);
const watersheds=JSON.parse(readFileSync(new URL('../public/watersheds.json',import.meta.url)));
for(const r of report.records.filter(r=>r.facilityIds.length)){
 const boundaries=watersheds.features.filter(f=>f.properties.recordId===r.id);
 assert.deepEqual(boundaries.map(f=>f.properties.level).sort((a,b)=>a-b),[2,4,8,12],`Missing watershed hierarchy for ${r.id}`);
 for(const f of boundaries){assert.ok(f.geometry.coordinates.length);assert.equal(f.properties.huc.length,f.properties.level);}
}
console.log(`Validated ${watersheds.features.length} USGS watershed boundaries and four hierarchy levels per mapped location.`);
const history=JSON.parse(readFileSync(new URL('../src/data/water-history.json',import.meta.url)));
assert.equal(history.recordId,'the-dalles-or');
assert.equal(history.openingYear,2006);
assert.deepEqual(history.rows.map(r=>r.year),Array.from({length:26},(_,i)=>2000+i));
for(const r of history.rows){assert.ok(r.meanCfs>=0);assert.equal(r.days,r.expectedDays);assert.ok(r.provisionalDays>=0&&r.provisionalDays<=r.days);}
assert.equal(history.rows.reduce((s,r)=>s+r.days,0),9497);
for(const [start,end] of [[2001,2005],[2007,2011],[2021,2025]]) assert.equal(history.rows.filter(r=>r.year>=start&&r.year<=end).length,5);
console.log('Validated historical coverage, opening-year exclusion, and equal five-year comparison windows.');
