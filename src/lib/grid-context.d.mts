import type {Geometry,FeatureCollection} from 'geojson';
export function pointInRing(point:number[],ring:number[][]):boolean;
export function containsPoint(geometry:Geometry|null,point:number[]):boolean;
export function loadGrid(id:string):Promise<FeatureCollection>;
export function downloadEvidence(filename:string,rows:unknown):void;

export function geometryBounds(geometry:Geometry|null):number[]|null;
