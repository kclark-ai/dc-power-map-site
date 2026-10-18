import watershedIndex from '../data/watershed-index.json';
import WaterHistory from './WaterHistory';
import WaterSystem from './WaterSystem';
import { useState } from 'react';
import disclosures from '../data/water-disclosures.json';
import {WATER_RECORDS,dailyGallons,type WaterRecord} from '../lib/water-data';
const number = (n: number) => Math.round(n).toLocaleString('en-US');
export function WaterEvidence({ record,includeHistory=true }: { record?: WaterRecord;includeHistory?:boolean }) {
  if (!record) return <p>Water source and daily use are not documented in this dataset for this facility. Unknown does not mean zero.</p>;
  return <>
    <p style={{color:'#0A0A0A',marginBottom:8}}>Google · {record.location} · {record.year}</p>
    <dl className="water-metrics">
      <div><dt>Average daily withdrawal</dt><dd>≈ {number(dailyGallons(record.withdrawalMillionGallons,record.year))} gal/day</dd></div>
      <div><dt>Average daily consumption</dt><dd>≈ {number(dailyGallons(record.consumptionMillionGallons,record.year))} gal/day</dd></div>
    </dl>
    <p>Reported annual withdrawal: {record.withdrawalMillionGallons.toLocaleString('en-US')} million US gallons. Consumption: {record.consumptionMillionGallons.toLocaleString('en-US')} million US gallons.</p>
    <p><strong>Water source:</strong> {record.sourceDescription || 'Named water supply and source shares are not verified in this dataset.'}</p>
    {record.sourceUrl && <p><a href={record.sourceUrl} target="_blank" rel="noopener noreferrer">Water source reference ↗</a></p>}
    {includeHistory&&<WaterHistory recordId={record.id}/>}<WaterSystem record={record}/><p><a href={disclosures.reportUrl} target="_blank" rel="noopener noreferrer">Google 2026 Environmental Report, p. 97 ↗</a></p>
    <p>Location-wide totals may cover multiple buildings or campuses. Do not sum repeated facility views. Daily figures are annual averages, not live meters or peak-day demand.</p>
  </>;
}
export default function WaterExplorer({ onSelect, onClose, canLocate, watershedLevel, onWatershedLevel }: { watershedLevel: number; onWatershedLevel: (n:number)=>void; canLocate: boolean; onSelect: (r: WaterRecord) => void; onClose: () => void }) {
 const [query,setQuery]=useState('');
 const rows=WATER_RECORDS.filter(r=>`${r.location} ${r.operator} ${(watershedIndex as Record<string,string[]>)[r.id]?.join(' ')||''}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.consumptionMillionGallons-a.consumptionMillionGallons);
 return <aside id="water-explorer" className="water-explorer" aria-label="Water sources and daily use" onKeyDown={e=>{if(e.key==='Escape')onClose();}}>
  <header><div><span className="water-eyebrow">WATER DISCLOSURES · 2025</span><h2>Where the water comes from.</h2></div><button aria-label="Close water panel" onClick={onClose}>×</button></header>
  <p>{WATER_RECORDS.length} Google-reported US locations, including 3 with water-source references. Sources and averages are shown where documented; other operators and unverified facilities remain unknown.</p>
  <button onClick={()=>setQuery("The Dalles")}>Explore before &amp; after · The Dalles pilot</button>
  <details><summary>How to read these figures</summary><p>Withdrawal is water taken from a supply. Consumption is withdrawal minus discharge. Annual totals are divided by 365 for 2025. These are onsite figures, excluding water used to generate electricity. Campus/location totals are not per-building readings. Source descriptions have separate reference dates.</p><p>Map markers identify representative reporting locations, not water intakes or pipe routes. Selected facility links are curated, not inferred from the nearest river.</p></details>
  <label htmlFor="watershed-level">Watershed boundary layer</label><select id="watershed-level" value={watershedLevel} onChange={e=>onWatershedLevel(Number(e.target.value))}><option value={0}>Off</option><option value={2}>Region · HUC 2</option><option value={4}>Subregion · HUC 4</option><option value={8}>Subbasin · HUC 8</option><option value={12}>Subwatershed · HUC 12</option></select><p>Blue-green circles scale with average daily consumption. One marker per mapped reporting location. Boundaries cover mapped reporting campuses only; nearby facilities with no disclosure are unknown.</p><label htmlFor="water-search">Find a reporting location</label><input id="water-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Location, operator, watershed, or HUC" />
  <p aria-live="polite">{rows.length} reporting locations</p>
  {rows.map(record=><article key={record.id}><span className="evidence-badge reported">Reported · {record.year}</span><h3>{record.location}</h3><p className="water-card-metric">≈ {number(dailyGallons(record.consumptionMillionGallons,record.year))} gal/day <small>consumed · annual average</small></p>{record.facilityIds.length>0 && canLocate ? <button className="primary-action" onClick={()=>onSelect(record)}>Inspect campus →</button>:<p className="evidence-note">Campus location not verified; disclosure available below.</p>}<details><summary>Disclosure, supply &amp; history</summary><WaterEvidence record={record}/></details></article>)}
  {rows.length===0&&<p>No matching disclosure. Try a city, county, or state abbreviation.</p>}
 </aside>;
}
