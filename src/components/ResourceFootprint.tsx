import { dailyGallons, waterForFacility } from '../lib/water-data';
export default function ResourceFootprint({facilityId,capacityMw,utility}:{facilityId:string;capacityMw?:number|null;utility?:string}) {
 const water=waterForFacility(facilityId);
 const amount=(n:number)=>Math.round(n).toLocaleString('en-US');
 return <section className="resource-footprint"><span className="water-eyebrow">RESOURCE FOOTPRINT</span><h3>What this campus uses</h3><p>Evidence coverage across water, energy, emissions, and land.</p>
 <dl>
 <div><dt>Water consumption <span>{water?'Reported · 2025':'Unknown'}</span></dt><dd>{water?`≈ ${amount(dailyGallons(water.consumptionMillionGallons,water.year))} gallons/day`:'No verified disclosure linked'}</dd>{water&&<small>Reporting-location total; may cover multiple buildings. Annual average.</small>}</div>
 <div><dt>Electrical capacity <span>{capacityMw&&capacityMw>0?'Inventory value':'Unknown'}</span></dt><dd>{capacityMw&&capacityMw>0?`${capacityMw.toLocaleString('en-US')} MW`:'No facility-specific capacity verified'}</dd><small>Capacity is not measured electricity consumption. Annual MWh remains unknown.</small></div>
 <div><dt>Electricity provider <span>{utility?'Inventory value':'Unknown'}</span></dt><dd>{utility||'Provider not documented'}</dd><small>Utility association does not establish a dedicated generation source.</small></div>
 <div><dt>Campus emissions <span>Unknown</span></dt><dd>Annual operational and electricity-related emissions not verified</dd></div>
 <div><dt>Land &amp; construction <span>Unknown</span></dt><dd>Acreage, material quantities, and embodied emissions not verified</dd></div>
 <div><dt>Backup fuel <span>Unknown</span></dt><dd>Generator runtime and diesel consumption not verified</dd></div>
 </dl><p>Unknown means missing evidence, not zero use. Regional power-plant emissions are not campus emissions.</p></section>;
}
