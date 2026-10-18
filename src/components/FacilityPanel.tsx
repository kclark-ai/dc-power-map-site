import {useEffect,useState} from 'react';
import {FacilityIdentity} from './FacilityIdentity';
import ResourceFootprint from './ResourceFootprint';
import {WaterEvidence} from './WaterExplorer';
import {waterForFacility,WATER_REPORT_URL} from '../lib/water-data';
import WaterHistory from './WaterHistory';
import {GridFacility} from './GridExplorer';
import {ProjectReviewNote} from './FacilityDirectory';
export type FacilityTab='overview'|'water'|'grid'|'history'|'sources';
type Facility={id:string;name:string;operator?:string|null;state:string;status:string;capacity_mw?:number|null;utility?:{name:string};lat:number;lon:number};
const tabs:FacilityTab[]=['overview','water','grid','history','sources'];
export default function FacilityPanel({dc,tab,onTab,onClose,showElectrons,onToggleElectrons,onCompare,comparisonState}:{dc:Facility;tab:FacilityTab;onTab:(tab:FacilityTab)=>void;onClose:()=>void;showElectrons:boolean;onToggleElectrons:()=>void;onCompare:()=>void;comparisonState:"available"|"added"|"full"}){
 const [collapsed,setCollapsed]=useState(false),[shareState,setShareState]=useState('');
 useEffect(()=>{const media=window.matchMedia('(max-width:800px)');const expandOnDesktop=()=>{if(!media.matches)setCollapsed(false)};media.addEventListener('change',expandOnDesktop);return()=>media.removeEventListener('change',expandOnDesktop)},[]);
 const record=waterForFacility(dc.id);
 const share=async()=>{try{const url=new URL(window.location.href);url.hash='explorer';await navigator.clipboard.writeText(url.toString());setShareState('Link copied')}catch{setShareState('Copy the address bar to share this view')}};
 return <aside className={`facility-panel ${collapsed?'is-collapsed':''}`} aria-label="Facility resource details" onKeyDown={e=>{if(e.key==='Escape')onClose()}}>
 <header className="facility-heading"><div><span className="evidence-badge inventory">Inventory record</span><h2>{dc.name||'Unnamed facility'}</h2><p>{dc.operator||'Operator unknown'} · {dc.state}</p></div><button aria-label="Close facility details" onClick={onClose}>×</button></header>
 <button className="sheet-handle" aria-expanded={!collapsed} onClick={()=>setCollapsed(v=>!v)}>{collapsed?'Expand details ↑':'Collapse to see map ↓'}</button>
 {!collapsed&&<><div role="tablist" aria-label="Facility information" className="facility-tabs">{tabs.map((t,i)=><button key={t} role="tab" id={`facility-tab-${t}`} aria-controls="facility-content" aria-selected={tab===t} tabIndex={tab===t?0:-1} onClick={()=>onTab(t)} onKeyDown={e=>{let next:number|undefined;if(e.key==='ArrowRight')next=(i+1)%tabs.length;if(e.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;if(e.key==='Home')next=0;if(e.key==='End')next=tabs.length-1;if(next!==undefined){e.preventDefault();onTab(tabs[next]);document.getElementById(`facility-tab-${tabs[next]}`)?.focus()}}}>{t}</button>)}</div>
 <div className="facility-content" id="facility-content" role="tabpanel" aria-labelledby={`facility-tab-${tab}`} tabIndex={0}>
 {tab==='overview'&&<><FacilityIdentity facilityId={dc.id} name={dc.name} operator={dc.operator}/><ProjectReviewNote facilityId={dc.id}/><p className="evidence-note">Listed status: {dc.status||'unknown'}. Operator, status, capacity, and utility are inherited inventory fields awaiting independent verification.</p><ResourceFootprint facilityId={dc.id} capacityMw={dc.capacity_mw} utility={dc.utility?.name}/><button className="primary-action" onClick={()=>onTab('water')}>{record?'Explore reported water use →':'Check water evidence →'}</button><button aria-pressed={showElectrons} onClick={onToggleElectrons}>Nearby plant context {showElectrons?'on':'off'}</button><p className="evidence-note">Proximity lines use approximate distance. They do not establish electricity supply.</p></>}
 {tab==='water'&&<><span className={`evidence-badge ${record?'reported':'unknown'}`}>{record?'Reported · 2025':'Unknown'}</span><WaterEvidence record={record} includeHistory={false}/></>}
 {tab==='grid'&&<GridFacility dc={dc}/>}
 {tab==='history'&&(record?<WaterHistory recordId={record.id}/>:<p>No verified opening date and relevant historical monitoring series are linked to this facility. Missing evidence does not imply no environmental change.</p>)}
 {tab==='sources'&&<><FacilityIdentity facilityId={dc.id} name={dc.name} operator={dc.operator} compact/><span className="evidence-badge context">Geographic context</span><h3>Evidence for this view</h3><p>Facility ID: <code>{dc.id}</code></p><p>Coordinates: {dc.lat.toFixed(4)}, {dc.lon.toFixed(4)}. Inventory location; not a verified intake or pipeline.</p><p><a href="https://im3.pnnl.gov/datacenter-atlas" target="_blank" rel="noopener noreferrer">Location inventory reference ↗</a></p>{record&&<p><a href={WATER_REPORT_URL} target="_blank" rel="noopener noreferrer">2025 water disclosure · Google report, p. 97 ↗</a></p>}{record?.sourceUrl&&<p><a href={record.sourceUrl} target="_blank" rel="noopener noreferrer">Water-supply reference ↗</a></p>}<p><a href="/evidence">Full sources, dates &amp; limitations →</a></p><p><a href={`mailto:kc@kevinclark.ai?subject=${encodeURIComponent(`Map correction: ${dc.id}`)}`}>Report a correction</a></p></>}
 </div><footer className="facility-footer"><button onClick={share}>Share this view ↗</button><button disabled={comparisonState==="full"} onClick={onCompare}>{comparisonState==="added"?"View comparison":comparisonState==="full"?"Comparison full (3)":"Add to comparison"}</button><span role="status">{shareState}</span></footer></>}
 </aside>
}
