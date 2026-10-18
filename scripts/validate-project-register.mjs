import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const register=JSON.parse(fs.readFileSync('src/data/project-register.json'));
const inventory=JSON.parse(fs.readFileSync('public/datacenters.json')).data;
const ids=new Set(inventory.map(d=>d.id)),seen=new Set();
for(const row of register.records){assert.ok(!seen.has(row.id));seen.add(row.id);assert.ok(['operational','under_construction','planned','announced','application','approved','cancelled','withdrawn'].includes(row.stage));assert.equal(row.evidenceLevel,'operator_statement');assert.ok(/^https:\/\//.test(row.sourceUrl));for(const key of ['stageAsOf','sourcePublished','reviewedAt'])assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(row[key]));assert.ok(row.stageAsOf<=row.reviewedAt);assert.ok(row.sourcePublished<=row.reviewedAt);assert.ok(row.phase&&row.reconciliation);assert.equal(row.coordinates,null,'Unresolved project identities must not create map coordinates');assert.equal(row.confirmedElectricalDemandMw,null,'Operator status review does not establish demand');for(const id of row.candidateInventoryIds)assert.ok(ids.has(id));}
console.log(`Validated ${seen.size} source-backed phase records, dates and unresolved map identities. No national-completeness claim.`);

const audit=JSON.parse(fs.readFileSync('public/future-project-audit.json'));
for(const [file,key] of [['public/datacenters.json','inventorySha256'],['src/data/project-register.json','projectRegisterSha256'],['src/data/future-project-reviews.json','reviewLedgerSha256']])assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),audit[key],`Review queue stale for ${file}; run node scripts/audit-future-projects.mjs after review`);
assert.deepEqual(new Set(audit.records.map(r=>r.id)),new Set(inventory.filter(d=>d.status!=='operational').map(d=>d.id)));
assert.equal(audit.summary.inheritedFutureRecords,audit.records.length);
assert.equal(audit.summary.withScopeReviewNotes+audit.summary.withoutDatedPhaseNotes,audit.records.length);
assert.ok(audit.records.every(r=>r.confirmedPhaseIdentity===false&&r.confirmedElectricalDemandMw===null));
console.log('Future-project review queue matches inventory and reviewed phase sources.');

const reviews=JSON.parse(fs.readFileSync('src/data/future-project-reviews.json'));
assert.equal(reviews.records.length,audit.records.length);
assert.equal(new Set(reviews.records.map(r=>r.inventoryId)).size,reviews.records.length);
assert.deepEqual(new Set(reviews.records.map(r=>r.inventoryId)),new Set(audit.records.map(r=>r.id)));
for(const r of reviews.records){assert.ok(['related_source_scope_unresolved','no_matching_primary_evidence'].includes(r.outcome));assert.match(r.reviewedAt,/^\d{4}-\d{2}-\d{2}$/);assert.ok(r.finding&&r.evidenceNeeded&&r.searchScope);assert.equal(r.currentStatusVerified,false);assert.equal(r.coordinateVerified,false);for(const s of r.sources){assert.match(s.url,/^https:\/\//);assert.ok(s.scope)}}
assert.equal(audit.summary.deskReviewedRecords,reviews.records.length);
assert.equal(audit.summary.withoutMatchingPrimaryEvidence,reviews.records.filter(r=>r.outcome==='no_matching_primary_evidence').length);
console.log('All 20 inherited future entries have review dispositions; unresolved findings are not verified statuses.');
