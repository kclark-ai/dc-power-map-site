"""Snapshot official USGS campus drainage context; never infer supply from proximity."""
import json, urllib.parse, concurrent.futures, subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1]
records=json.loads((root/'src/data/water-disclosures.json').read_text())['records']
dcs=json.loads((root/'public/datacenters.json').read_text())['data']
base='https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer'
def fetch(record):
 dc=next((d for d in dcs if d['id'] in record['facilityIds']),None)
 if not dc:return []
 features=[]
 for layer,digits in [(1,2),(2,4),(4,8),(6,12)]:
  params={'f':'geojson','geometry':f"{dc['lon']},{dc['lat']}",'geometryType':'esriGeometryPoint','inSR':4326,'spatialRel':'esriSpatialRelIntersects','outFields':f'name,huc{digits}','outSR':4326,'maxAllowableOffset':0.002,'returnGeometry':'true'}
  url=f'{base}/{layer}/query?'+urllib.parse.urlencode(params)
  result=json.loads(subprocess.check_output(['curl','-fsSL','--retry','2','--max-time','90',url]))
  if 'error' in result: raise RuntimeError(result['error'])
  for f in result.get('features',[]):
   f['properties']={'recordId':record['id'],'level':digits,'name':f['properties']['name'],'huc':f['properties'][f'huc{digits}']}
   features.append(f)
 return features
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
 features=[f for group in pool.map(fetch,records) for f in group]
(root/'public/watersheds.json').write_text(json.dumps({'type':'FeatureCollection','metadata':{'source':base,'retrieved':'2026-10-16','meaning':'Representative campus drainage context, not verified supply watersheds','simplificationDegrees':0.002},'features':features},separators=(',',':')))
print(f'Saved {len(features)} USGS watershed boundaries')

index={}
for f in features:
 p=f['properties'];index.setdefault(p['recordId'],[]).append(p['name']+' '+p['huc'])
(root/'src/data/watershed-index.json').write_text(json.dumps(index,indent=2)+'\n')
