import disclosures from '../data/water-disclosures.json';
export type WaterRecord=typeof disclosures.records[number];
export const WATER_RECORDS=disclosures.records;
export const WATER_REPORT_URL=disclosures.reportUrl;
const byFacility=new Map<string,WaterRecord>();
for(const record of WATER_RECORDS) for(const id of record.facilityIds) byFacility.set(id,record);
export const waterForFacility=(id:string)=>byFacility.get(id);
export function dailyGallons(millionGallons:number,year:number){return millionGallons*1e6/((Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/86400000)}
