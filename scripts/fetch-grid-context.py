"""Download dated public boundary snapshots. Never infer present service relationships."""
import json,hashlib,urllib.parse,datetime,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1]
base='https://services5.arcgis.com/HDRa0B57OVrv2E1q/arcgis/rest/services/'
sets=[('nerc','Historical NERC regions / subregions',base+'NERC_Regions/FeatureServer/0','NAME,SUBNAME,SOURCEDATE,VAL_DATE','HIFLD-derived public service; original source fields retained'),('iso','Historical ISO / RTO footprints','https://services8.arcgis.com/Rl9BjEMrBgxxeBfh/arcgis/rest/services/Independent_System_Operator/FeatureServer/0','NAME,SOURCEDATE,VAL_DATE,YEAR','PNNL public service; HIFLD-derived FERC / EIA / Census source'),('ba','Historical electric planning areas',base+'Electric_Planning_Areas/FeatureServer/0','NAME,ABBRV,SOURCEDATE,VAL_DATE,YEAR','HIFLD-derived public service; planning areas are not confirmed current balancing-authority assignments'),('utility','Historical retail service territories',base+'Electric_Retail_Service_Territories/FeatureServer/0','NAME,SOURCEDATE,VAL_DATE','HIFLD-derived public service; territory coverage does not confirm campus service')]
def date(v):
 try:return datetime.datetime.fromtimestamp(v/1000,datetime.timezone.utc).date().isoformat()
 except:return None
manifest={'retrievedAt':'2026-10-17','scope':'Dated historical geographic context. Not current operational boundaries or confirmed campus electrical relationships.','layers':[]}
for key,title,url,fields,publisher in sets:
 features=[];offset=0
 while True:
  params={'where':'1=1','outFields':fields,'returnGeometry':'true','outSR':'4326','maxAllowableOffset':'0.01','geometryPrecision':'4','resultRecordCount':'1000','resultOffset':str(offset),'f':'geojson'}
  raw_response=subprocess.check_output(['curl','--silent','--show-error','--fail','--retry','2','--max-time','60',url+'/query?'+urllib.parse.urlencode(params)])
  data=json.loads(raw_response)
  if 'error' in data:raise RuntimeError(str(data['error']))
  rows=data.get('features',[])
  if not rows:break
  features.extend(rows);offset+=len(rows)
  if not data.get('exceededTransferLimit') and len(rows)<1000:break
 for i,f in enumerate(features):
  p=f['properties'];f['properties']={'id':key+'-'+str(i),'name':p.get('NAME'),'subregion':p.get('SUBNAME'),'abbreviation':p.get('ABBRV'),'sourceDate':date(p.get('SOURCEDATE')),'validationDate':date(p.get('VAL_DATE')),'metricYear':p.get('YEAR')}
  f.pop('id',None)
 payload={'type':'FeatureCollection','features':features}
 raw=json.dumps(payload,separators=(',',':')).encode();(root/'public/grid'/f'{key}.geojson').write_bytes(raw)
 dates=sorted({f['properties']['sourceDate'] for f in features if f['properties']['sourceDate']})
 manifest['layers'].append({'id':key,'title':title,'url':url,'publisher':publisher,'sourceDates':[dates[0],dates[-1]] if dates else [],'features':len(features),'sha256':hashlib.sha256(raw).hexdigest(),'file':f'/grid/{key}.geojson','simplificationDegrees':0.01})
 print(key,len(features),len(raw),'bytes',dates[0] if dates else 'undated',dates[-1] if dates else 'undated',flush=True)
(root/'src/data/grid-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
