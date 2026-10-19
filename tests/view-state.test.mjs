import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseView,serializeView} from '../src/lib/view-state.mjs';
test('shared water history retains facility, camera and watershed',()=>{const view={grid:"none",hasCamera:true,mode:'water',tab:'history',facility:'dc_pnnl_00171',lon:-121.2013,lat:45.6321,zoom:12,watershed:12,plants:false,centers:false,planned:false,fuels:['coal','hydro']};assert.deepEqual(parseView(serializeView(view)),view)});
test('malformed external links cannot introduce invalid map coordinates or tabs',()=>{const p=parseView('?view=bad&tab=bad&lat=999&lon=NaN&zoom=-9&huc=99');assert.equal(p.mode,'overview');assert.equal(p.tab,'overview');assert.equal(p.lat,38);assert.equal(p.lon,-96);assert.equal(p.zoom,4);assert.equal(p.watershed,8)});
test('legacy facility links and disabled watershed remain supported',()=>{assert.equal(parseView('?facility=dc_pnnl_00171').facility,'dc_pnnl_00171');assert.equal(parseView('?huc=0').watershed,0)});

test('default map opens with a clean URL while custom views remain shareable',()=>{
 const defaults=parseView('');assert.equal(serializeView(defaults),'');
 assert.equal(serializeView(parseView('?view=water')),'view=water');
 const custom=parseView('?view=energy&centers=0&plants=0&planned=1&fuels=coal&huc=0');
 assert.deepEqual(parseView(serializeView(custom)),custom);
});
