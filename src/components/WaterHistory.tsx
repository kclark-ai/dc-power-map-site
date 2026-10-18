import { useId, useState } from 'react';
import history from '../data/water-history.json';
const fmt=(n:number)=>Math.round(n).toLocaleString('en-US');
export default function WaterHistory({recordId}:{recordId:string}) {
 const [window,setWindow]=useState('early');
 const [table,setTable]=useState(false);
 const label=useId();
 if(recordId!==history.recordId) return <details className="water-history"><summary>Before &amp; after operation</summary><p>A comparison is not available yet. This location needs a sourced opening date and a relevant monitoring record spanning the years before and after opening. Missing measurements are not zero.</p></details>;
 const before=history.rows.filter(r=>r.year>=2001&&r.year<=2005);
 const after=history.rows.filter(r=>window==='early'?r.year>=2007&&r.year<=2011:r.year>=2021&&r.year<=2025);
 const mean=(rows:typeof before)=>rows.reduce((sum,r)=>sum+r.meanCfs,0)/rows.length;
 const baseline=mean(before),recent=mean(after),change=(recent/baseline-1)*100;
 const max=Math.ceil(Math.max(...history.rows.map(r=>r.meanCfs))/50000)*50000;
 const x=(year:number)=>48+(year-2000)/25*500;
 const y=(value:number)=>160-value/max*130;
 const points=history.rows.map(r=>`${x(r.year)},${y(r.meanCfs)}`).join(' ');
 return <section className="water-history"><span className="water-eyebrow">HISTORICAL CONTEXT · PILOT</span><h4>Before &amp; after operation</h4>
 <p>{history.stationName} · {history.stationId}</p>
 <p><strong>River flow, not a watershed water level.</strong> This regional gauge is not a verified monitor of the campus supply. Reservoir storage, groundwater level, and streamflow are separate measurements.</p>
 <label htmlFor={label}>Comparison period</label><select id={label} value={window} onChange={e=>setWindow(e.target.value)}><option value="early">First five full years after opening</option><option value="recent">Latest five complete years</option></select>
 <div className="history-comparison"><div><small>Before · 2001–2005</small><strong>{fmt(baseline)} ft³/s</strong></div><div><small>After · {after[0].year}–{after[after.length-1].year}</small><strong>{fmt(recent)} ft³/s</strong></div></div>
 <p>Observed difference: <strong>{change>=0?'+':''}{change.toFixed(1)}%</strong>. Equal five-year windows; arithmetic mean of annual means. Opening year excluded.</p>
 <svg viewBox="0 0 580 202" role="img" aria-label="Annual mean Columbia River discharge from 2000 through 2025, with the 2006 campus opening marked. This is regional context, not an impact estimate.">
 <rect x="48" y="24" width={x(2006)-48} height="136" fill="#E8DFC9"/>
 {[0,max/2,max].map(v=><g key={v}><line x1="48" x2="548" y1={y(v)} y2={y(v)} stroke="#D4D1CB"/><text x="43" y={y(v)+4} textAnchor="end">{v/1000}k</text></g>)}
 <polyline points={points} fill="none" stroke="#245D62" strokeWidth="2.5"/>
 <line x1={x(2006)} x2={x(2006)} y1="20" y2="164" stroke="#9A6B1E" strokeDasharray="4 4"/>
 <text x={x(2006)+5} y="16">2006 opening</text>
 {history.rows.map(r=><circle key={r.year} cx={x(r.year)} cy={y(r.meanCfs)} r="3" fill="#245D62"><title>{r.year}: {fmt(r.meanCfs)} ft³/s · {r.days}/{r.expectedDays} days</title></circle>)}
 {[2000,2010,2020,2025].map(yr=><text key={yr} x={x(yr)} y="182" textAnchor="middle">{yr}</text>)}<text x="48" y="199">Annual mean discharge · ft³/s</text>
 </svg>
 <p>Complete daily coverage for all 26 years (2000–2025). Snapshot: {history.retrievedAt.slice(0,10)} UTC. {history.rows.reduce((sum,r)=>sum+r.provisionalDays,0)} daily values not marked approved.</p>
 <p><strong>This does not isolate a data-center effect.</strong> Weather, snowpack, dam operations, other withdrawals, and campus expansion can affect comparisons. No climate adjustment or control-basin analysis has been applied.</p>
 <p><a href={history.openingSource} target="_blank" rel="noopener noreferrer">Opening date: Google ↗</a> · <a href={history.stationUrl} target="_blank" rel="noopener noreferrer">USGS gauge ↗</a> · <a href={history.downloadUrl} target="_blank" rel="noopener noreferrer">Daily source data ↗</a></p>
 <button aria-expanded={table} onClick={()=>setTable(v=>!v)}>{table?'Hide':'Show'} annual observations</button>
 {table&&<div className="history-table"><table><caption>Calendar-year mean discharge; daily coverage</caption><thead><tr><th>Year</th><th>ft³/s</th><th>Days</th></tr></thead><tbody>{history.rows.map(r=><tr key={r.year}><th>{r.year}</th><td>{fmt(r.meanCfs)}</td><td>{r.days}/{r.expectedDays}</td></tr>)}</tbody></table></div>}
 </section>;
}
