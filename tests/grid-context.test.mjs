import {test} from 'node:test';
import assert from 'node:assert/strict';
import {containsPoint,geometryBounds} from '../src/lib/grid-context.mjs';
import {parseView,serializeView} from '../src/lib/view-state.mjs';
const polygon={type:'Polygon',coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[3,3],[7,3],[7,7],[3,7],[3,3]]]};
test('grid context respects polygon holes and disconnected polygons',()=>{assert.equal(containsPoint(polygon,[1,1]),true);assert.equal(containsPoint(polygon,[5,5]),false);assert.equal(containsPoint(polygon,[15,5]),false);const multi={type:'MultiPolygon',coordinates:[polygon.coordinates,[[[20,20],[22,20],[22,22],[20,22],[20,20]]]]};assert.equal(containsPoint(multi,[21,21]),true);assert.deepEqual(geometryBounds(multi),[0,0,22,22]);});
test('grid selections survive share links and malformed layers stay off',()=>{const view=parseView('?view=grid&grid=iso&tab=grid&facility=abc');assert.equal(parseView(serializeView(view)).grid,'iso');assert.equal(parseView(serializeView(view)).tab,'grid');assert.equal(parseView('?grid=invalid').grid,'none');assert.equal(parseView('?view=grid').mode,'grid')});
