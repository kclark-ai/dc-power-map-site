"""Validate a USGS daily response and generate a reproducible annual history snapshot.
Usage: python3 scripts/prepare-water-history.py /path/to/usgs-response.json
Download URL is preserved in the output; no missing days are interpolated.
"""
import json,sys,calendar,statistics
from pathlib import Path
from collections import defaultdict
root=Path(__file__).resolve().parents[1]
data=json.loads(Path(sys.argv[1]).read_text())
assert not any(link.get('rel')=='next' for link in data['links']), 'Fetch all pages before preparing history'
years=defaultdict(dict)
for f in data['features']:
 p=f['properties']
 assert p['monitoring_location_id']=='USGS-14105700' and p['parameter_code']=='00060' and p['statistic_id']=='00003'
 assert p['unit_of_measure']=='ft^3/s'
 date=p['time'][:10];year=int(date[:4]);value=float(p['value'])
 assert 2000<=year<=2025 and value>=0
 assert date not in years[year], 'Duplicate daily series'
 years[year][date]=(value,p['approval_status'])
rows=[]
for year in range(2000,2026):
 samples=years[year];expected=366 if calendar.isleap(year) else 365
 assert len(samples)==expected, f'Incomplete year {year}'
 rows.append({'year':year,'meanCfs':round(statistics.mean(v[0] for v in samples.values()),2),'days':len(samples),'expectedDays':expected,'provisionalDays':sum(v[1]!='Approved' for v in samples.values())})
url=next(l['href'] for l in data['links'] if l['rel']=='self')
output={'recordId':'the-dalles-or','stationId':'USGS-14105700','stationName':'Columbia River at The Dalles, OR','relationship':'Regional river context; not a verified source-water or campus-impact gauge','openingYear':2006,'openingSource':'https://www.datacenters.google/locations/oregon/','stationUrl':'https://waterdata.usgs.gov/monitoring-location/USGS-14105700/','downloadUrl':url,'retrievedAt':data['timeStamp'],'metric':'Annual mean of daily mean discharge','unit':'ft³/s','rows':rows}
(root/'src/data/water-history.json').write_text(json.dumps(output,indent=2)+'\n')
print(f'Validated {sum(r["days"] for r in rows)} daily observations across {len(rows)} complete calendar years')
