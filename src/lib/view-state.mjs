const MODES=['overview','water','energy','grid'];
const FUELS=['coal','natural_gas','nuclear','solar','wind','hydro'];
const TABS=['overview','water','grid','history','sources'];
const finite=(v,min,max,fallback)=>{const n=Number(v);return v!==null&&Number.isFinite(n)&&n>=min&&n<=max?n:fallback};
export function parseView(search){const p=new URLSearchParams(search);return {grid:['none','nerc','iso','ba','utility'].includes(p.get('grid'))?p.get('grid'):'none',hasCamera:p.has('lon')&&p.has('lat')&&p.has('zoom'),mode:MODES.includes(p.get('view'))?p.get('view'):'overview',tab:TABS.includes(p.get('tab'))?p.get('tab'):'overview',facility:p.get('facility')||null,plants:p.has('plants')?p.get('plants')==='1':p.get('view')==='energy',centers:p.has('centers')?p.get('centers')==='1':p.get('view')!=='water',planned:p.get('planned')==='1',fuels:p.has('fuels')?p.get('fuels').split(',').filter(f=>FUELS.includes(f)):FUELS,lon:finite(p.get('lon'),-180,180,-96),lat:finite(p.get('lat'),-85,85,38),zoom:finite(p.get('zoom'),2,18,4),watershed:[0,2,4,8,12].includes(Number(p.get('huc')))&&p.has('huc')?Number(p.get('huc')):8};}
export function serializeView(view){
 const p=new URLSearchParams();
 const mode=MODES.includes(view.mode)?view.mode:'overview';
 if(mode!=='overview')p.set('view',mode);
 if(view.grid&&view.grid!=='none')p.set('grid',view.grid);
 if(view.tab&&view.tab!=='overview')p.set('tab',view.tab);
 if(view.facility)p.set('facility',view.facility);
 const lon=view.lon.toFixed(4),lat=view.lat.toFixed(4),zoom=view.zoom.toFixed(2);
 if(view.hasCamera||lon!=='-96.0000'||lat!=='38.0000'||zoom!=='4.00'){p.set('lon',lon);p.set('lat',lat);p.set('zoom',zoom)}
 if(view.watershed!==8)p.set('huc',String(view.watershed));
 if(view.plants!==(mode==='energy'))p.set('plants',view.plants?'1':'0');
 if(view.centers!==(mode!=='water'))p.set('centers',view.centers?'1':'0');
 if(view.planned)p.set('planned','1');
 const fuels=view.fuels||FUELS;
 if(fuels.length!==FUELS.length||!FUELS.every(f=>fuels.includes(f)))p.set('fuels',fuels.join(','));
 return p.toString();
}
