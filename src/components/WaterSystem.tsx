import { useEffect, useState } from 'react';
import type { WaterRecord } from '../lib/water-data';
type Boundary = { properties: {recordId:string; level:number; name:string; huc:string} };
const traces: Record<string,{steps:string[]; note:string; url:string}> = {
 'the-dalles-or': {steps:['Dog River diversion + South Fork Mill Creek','Crow Creek Reservoir → municipal treatment','City of The Dalles supply + supplemental groundwater','Google reporting location'],note:'The watershed council documents a transfer from Dog River (Hood River drainage) into South Fork Mill Creek. Municipal source shares and campus pipe routes are not published here. Supply references are historical; the 2025 usage report does not establish source shares.',url:'https://www.wascowatersheds.org/the-dalles'},
 'douglas-county-ga': {steps:['Municipal wastewater','WSA Sweetwater Creek wastewater treatment plant','Reclaimed-water supply + potable supplement','Google cooling → onsite treatment → Chattahoochee River'],note:'The utility’s 2012 report documents this reuse and return pathway. The 2025 Google table reports 394.3 million gallons reclaimed and 46.3 million gallons potable withdrawal; it does not verify current pipe routes or discharge allocation.',url:'https://ddcwsa.com/wp-content/uploads/2023/03/2012WaterQualityReport.pdf'},
 'council-bluffs-ia': {steps:['Missouri River floodplain aquifer','Supply infrastructure / treatment: not verified','Google reporting location','Return destination: not verified'],note:'MidAmerican identifies the aquifer source. Groundwater flow paths, intake locations, and supplier allocation are not verified in this dataset.',url:'https://www.midamericanenergy.com/datacenters/water'}
};
let watershedRequest: Promise<{features:Boundary[]}> | undefined;
export default function WaterSystem({record}:{record:WaterRecord}) {
 const [boundaries,setBoundaries]=useState<Boundary[]>([]);
 const [failed,setFailed]=useState(false);
 useEffect(()=>{let active=true;(watershedRequest ??= fetch('/watersheds.json').then(r=>{if(!r.ok)throw Error();return r.json()})).then(d=>{if(active)setBoundaries(d.features)}).catch(()=>{if(active)setFailed(true)});return()=>{active=false}},[]);
 const trace=traces[record.id];
 const local=boundaries.filter(b=>b.properties.recordId===record.id).sort((a,b)=>a.properties.level-b.properties.level);
 return <section className="water-system"><h4>Trace the water system</h4>
 {trace?<><ol className="water-path">{trace.steps.map(s=><li key={s}>{s}</li>)}</ol><p>{trace.note}</p><a href={trace.url} target="_blank" rel="noopener noreferrer">Supply-system evidence ↗</a></>:<p>Supply system not yet documented. Intake, supplier, treatment, and return-flow connections remain unknown.</p>}
 <h4>Campus watershed hierarchy</h4><p>Geographic drainage context at the representative campus. These boundaries do not establish the water supply or groundwater recharge area.</p>
 {local.length>0?<ol className="watershed-path">{local.map(({properties:p})=><li key={p.level}><small>HUC {p.level} · {p.huc}</small><br/>{p.name}</li>)}</ol>:<p>{failed?'Watershed context could not load.':record.facilityIds.length?'Loading watershed context…':'No verified campus association; watershed context unavailable.'}</p>}
 <a href="https://www.usgs.gov/national-hydrography/watershed-boundary-dataset" target="_blank" rel="noopener noreferrer">USGS Watershed Boundary Dataset ↗</a>
 </section>
}
