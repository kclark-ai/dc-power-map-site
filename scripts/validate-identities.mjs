import fs from 'node:fs';
import assert from 'node:assert/strict';
const ledger=JSON.parse(fs.readFileSync('public/facility-identities.json'));
const inventory=JSON.parse(fs.readFileSync('public/datacenters.json')).data;
const ids=new Set(inventory.map(r=>r.id)),seen=new Set(),linked=new Set();
for(const p of ledger.profiles){assert.ok(!seen.has(p.id));seen.add(p.id);assert.match(p.sourceUrl,/^https:\/\//);assert.match(p.reviewedAt,/^\d{4}-\d{2}-\d{2}$/);assert.ok(p.sourcePublished===null||/^\d{4}-\d{2}-\d{2}$/.test(p.sourcePublished));assert.ok(['campus_context_only','potential_project_match'].includes(p.association));assert.ok(p.scope&&p.relationships.length);assert.equal(p.propertyOwner,null,'No legal owner established by these sources');assert.equal(p.tenants,null,'Hosting customer is not confirmed building tenant');for(const id of p.candidateInventoryIds){assert.ok(ids.has(id));assert.ok(!linked.has(id),'Ambiguous multiple profiles require explicit reconciliation');linked.add(id)}for(const r of p.relationships)assert.ok(r.role&&r.business&&r.basis)}
console.log(`Validated ${seen.size} identity source profiles and ${linked.size} candidate inventory links; no confirmed ownership or parcel identity claimed.`);
