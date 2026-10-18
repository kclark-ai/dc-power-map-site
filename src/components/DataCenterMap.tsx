import type * as GeoJSON from 'geojson';
import FacilityPanel, {type FacilityTab} from './FacilityPanel';
import {parseView,serializeView} from '../lib/view-state.mjs';
import WaterExplorer from './WaterExplorer';
import GridExplorer,{GridLayerSelect} from './GridExplorer';
import FacilityComparison from './FacilityComparison';
import FacilityDirectory from './FacilityDirectory';
import gridManifest from '../data/grid-manifest.json';
import {loadGrid,geometryBounds} from '../lib/grid-context.mjs';
import {WATER_RECORDS,type WaterRecord,dailyGallons} from '../lib/water-data';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {Map as MapboxMap,GeoJSONSource} from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = import.meta.env.PUBLIC_MAPBOX_TOKEN;

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:       '#FAFAF7',
  surface:  '#FAFAF7',
  surface2: '#F3F2EF',
  surface3: '#E8E6E1',
  border:   '#E8E6E1',
  border2:  '#D4D1CB',
  text:     '#0A0A0A',
  text2:    '#525252',
  text3:    '#70706B',
  green:    '#9A6B1E',
  orange:   '#ff7235',
  red:      '#ff2d55',
} as const;

const MONO = "'JetBrains Mono', 'Courier New', monospace";
const SANS = "'Inter', system-ui, -apple-system, sans-serif";

const FUEL: Record<string, string> = {
  coal:        '#665d59',
  natural_gas: '#ba8150',
  nuclear:     '#817395',
  solar:       '#B89535',
  wind:        '#6d9381',
  hydro:       '#4A7A8C',
  other:       '#4a6280',
};

const ALL_FUELS = ['coal', 'natural_gas', 'nuclear', 'solar', 'wind', 'hydro'] as const;
type FuelKey = typeof ALL_FUELS[number];

// ── Types ─────────────────────────────────────────────────────────────────────
type PowerMix = {
  nuclear: number; natural_gas: number; solar: number; wind: number;
  coal: number; hydro: number; other: number; source: string;
};
type DataCenter = {
  id: string; name: string; operator: string; lat: number; lon: number;
  state: string; status: string; power_mix: PowerMix; direct_ppas: any[];
  utility: { name: string; type: string };
  capacity_mw?: number | null;
  notes?: string | null;
};
type TourStop = {
  id: string; label: string; center: [number, number]; zoom: number;
  title: string; headline: string; facts: string[]; color: string;
};
type SearchResult = {
  kind: 'dc' | 'plant';
  id: string;
  name: string;
  secondary: string;
  state: string;
  lat: number;
  lon: number;
  score: number;
  payload: any;
};
type MapStats = {
  totalDCs: number; mwDemand: number;
  co2Tons: number; plantCount: number;
  withPPA: number; withoutPPA: number;
};

// ── Tour stops ────────────────────────────────────────────────────────────────
const TOUR_STOPS: TourStop[] = [
 {id:'nova',label:'Northern Virginia',center:[-77.48,38.92],zoom:9.5,title:'Explore the inventory',headline:'Facility locations are a starting point for research.',facts:['Markers come from the retained location inventory; status and operator are not independently verified for every record.','A concentration of markers does not establish measured electricity demand.','Use Sources & evidence for coverage and reporting dates.'],color:C.orange},
 {id:'phoenix',label:'Phoenix, Arizona',center:[-111.97,33.44],zoom:9.5,title:'Water evidence',headline:'Water use varies by reporting location and cooling system.',facts:['Open the water view to inspect annual disclosures and their daily averages.','A nearby river does not establish a water-supply connection.','Unknown water use does not mean zero.'],color:'#9A6B1E'},
 {id:'pnw',label:'The Dalles, Oregon',center:[-121.2013,45.63205],zoom:10,title:'History and supply',headline:'Supply pathways and river conditions answer different questions.',facts:['The documented municipal supply includes surface water and groundwater.','The historical Columbia River chart provides regional context, not a campus-impact estimate.','Source links, reporting years, and comparison coverage are included in the water panel.'],color:C.green},
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMixColor(_mix: PowerMix): string { return '#303A39'; }

const AMBER = '#f59e0b';
const LAVENDER = '#B6A17D';

function searchAll(q: string, dcs: DataCenter[], plants: any[]): SearchResult[] {
  if (q.trim().length < 2) return [];
  const ql = q.trim().toLowerCase();
  const rank = (text?: string | null): number => {
    if (!text) return 0;
    const t = text.toLowerCase();
    if (t === ql) return 100;
    if (t.startsWith(ql)) return 80;
    if (t.split(/[\s,.-]+/).some((w: string) => w.startsWith(ql))) return 65;
    if (t.includes(ql)) return 50;
    return 0;
  };

  const dcResults: SearchResult[] = [];
  for (const dc of dcs) {
    const s = Math.max(
      rank(dc.name),
      rank(dc.operator) * 0.9,
      rank(dc.state) * 0.7,
      rank((dc as any).county) * 0.6,
    );
    if (s > 0) {
      dcResults.push({
        kind: 'dc', id: dc.id,
        name: dc.name || dc.operator || 'Unnamed',
        secondary: [
          dc.operator && dc.operator !== dc.name ? dc.operator : null,
          dc.status !== 'operational' ? dc.status.replace(/_/g, ' ') : null,
        ].filter(Boolean).join(' · '),
        state: dc.state || '', lat: dc.lat, lon: dc.lon,
        score: s, payload: dc,
      });
    }
  }
  dcResults.sort((a, b) => b.score - a.score);

  const plantResults: SearchResult[] = [];
  for (const p of plants) {
    const s = Math.max(rank(p.name), rank(p.state) * 0.7);
    if (s > 0) {
      plantResults.push({
        kind: 'plant', id: `p_${p.lat}_${p.lon}`,
        name: p.name || 'Unnamed Plant',
        secondary: `${(p.fuel_type || '').replace(/_/g, ' ')}${p.capacity_mw ? ` · ${p.capacity_mw} MW` : ''}`,
        state: p.state || '', lat: p.lat, lon: p.lon,
        score: s, payload: p,
      });
      if (plantResults.length >= 40) break; // early-exit for 14k plant array
    }
  }
  plantResults.sort((a, b) => b.score - a.score);

  return [...dcResults.slice(0, 6), ...plantResults.slice(0, 4)];
}

function findNearestPlants(dcLat: number, dcLon: number, plants: any[], n = 3): any[] {
  if (!plants.length) return [];
  return [...plants]
    .filter(p => p.lat && p.lon && p.fuel_type && p.fuel_type !== 'other')
    .map(p => ({ ...p, _dist: Math.hypot(p.lat - dcLat, p.lon - dcLon) }))
    .sort((a, b) => a._dist - b._dist)
    .slice(0, n);
}

// ── Shared primitives ─────────────────────────────────────────────────────────
function Toggle({
  on, onChange, label, sublabel, disabled,
}: {
  on: boolean; onChange: () => void; label: string; sublabel?: string; disabled?: boolean;
}) {
  return (
    <div role="switch" aria-label={label} aria-checked={on} aria-disabled={disabled} tabIndex={disabled?-1:0} onKeyDown={e=>{if(!disabled&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onChange()}}}
      onClick={disabled ? undefined : onChange}
      style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 12, padding: '7px 0',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        userSelect: 'none',
      }}
    >
      <div>
        <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 500, color: on ? C.text : C.text2, transition: 'color 0.15s' }}>
          {label}
        </div>
        {sublabel && (
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.text3, marginTop: 3, lineHeight: 1.45 }}>
            {sublabel}
          </div>
        )}
      </div>
      <div style={{
        flexShrink: 0, width: 34, height: 18, borderRadius: 9, marginTop: 2,
        background: on ? C.green : C.surface3,
        border: `1px solid ${on ? C.green + '80' : C.border2}`,
        position: 'relative', transition: 'background 0.18s, border-color 0.18s',
      }}>
        <div style={{
          position: 'absolute', top: 2, left: on ? 16 : 2,
          width: 12, height: 12, borderRadius: '50%',
          background: on ? C.bg : C.text3,
          transition: 'left 0.18s cubic-bezier(0.22,1,0.36,1), background 0.18s',
        }} />
      </div>
    </div>
  );
}

function FuelCheckbox({
  color, label, checked, onChange, disabled,
}: {
  color: string; label: string; checked: boolean; onChange: () => void; disabled?: boolean;
}) {
  return (
    <div role="checkbox" aria-label={label} aria-checked={checked} aria-disabled={disabled} tabIndex={disabled?-1:0} onKeyDown={e=>{if(!disabled&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onChange()}}}
      onClick={disabled ? undefined : onChange}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        cursor: disabled ? 'default' : 'pointer',
        padding: '5px 0', userSelect: 'none',
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <div style={{
        width: 14, height: 14, borderRadius: 3, flexShrink: 0,
        background: checked ? color : 'transparent',
        border: `1.5px solid ${checked ? color : C.border2}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
      }}>
        {checked && <span style={{ color: '#000', fontSize: 9, fontWeight: 800, lineHeight: 1 }}>✓</span>}
      </div>
      <div style={{ width: 7, height: 7, borderRadius: 2, background: color, flexShrink: 0, boxShadow: `0 0 5px ${color}70` }} />
      <span style={{ fontFamily: MONO, fontSize: 11, color: checked ? C.text2 : C.text3, transition: 'color 0.15s' }}>
        {label}
      </span>
    </div>
  );
}

// ── FuelBar ───────────────────────────────────────────────────────────────────
// ── TourCallout ───────────────────────────────────────────────────────────────
function TourCallout({ stop, stopIndex, total, onSkip, onNext }: {
  stop: TourStop; stopIndex: number; total: number; onSkip: () => void; onNext: () => void;
}) {
  const isLast = stopIndex + 1 >= total;
  return (
    <div style={{ position: 'absolute', bottom: 44, left: '50%', zIndex: 30, width: 'min(520px, calc(100vw - 24px))' }}>
      <style>{`
        @keyframes tourSlideUp   { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
        @keyframes tourCountdown { from { width:0%; } to { width:100%; } }
      `}</style>
      <div key={stopIndex} style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderTop: `2px solid ${stop.color}`, borderRadius: 10,
        padding: '20px 24px 24px',
        boxShadow: `0 0 0 1px ${C.border}, 0 32px 80px rgba(0,0,0,0.85), 0 0 120px ${stop.color}14`,
        animation: 'tourSlideUp 0.24s cubic-bezier(0.22,1,0.36,1)',
        position: 'relative', overflow: 'hidden',
        transform: 'translateX(-50%)', fontFamily: SANS,
      }}>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: C.surface3 }}>
          <div style={{ height: '100%', background: stop.color, borderRadius: 1, animation: 'tourCountdown 4s linear forwards' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: stop.color, boxShadow: `0 0 8px ${stop.color}` }} />
            <span style={{ fontFamily: MONO, fontSize: 9, color: stop.color, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Stop {stopIndex + 1} of {total}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 9, color: C.text3, letterSpacing: '0.06em' }}>· {stop.label}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onNext} style={{
              fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: '0.1em',
              padding: '5px 13px', borderRadius: 4, cursor: 'pointer',
              border: `1px solid ${stop.color}60`, background: `${stop.color}18`,
              color: stop.color, textTransform: 'uppercase',
            }}>{isLast ? 'Finish' : 'Next →'}</button>
            <button onClick={onSkip} style={{
              fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: '0.1em',
              padding: '5px 13px', borderRadius: 4, cursor: 'pointer',
              border: `1px solid ${C.border}`, background: 'transparent',
              color: C.text3, textTransform: 'uppercase',
            }}>✕ Skip</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 5, marginBottom: 18 }}>
          {TOUR_STOPS.map((s, i) => (
            <div key={s.id} style={{
              height: 2, flex: 1, borderRadius: 1,
              background: i < stopIndex ? stop.color : i === stopIndex ? `${stop.color}80` : C.surface3,
              transition: 'background 0.3s',
            }} />
          ))}
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: '-0.025em', lineHeight: 1.2, marginBottom: 10 }}>
          {stop.title}
        </div>
        <div style={{ fontSize: 13, fontWeight: 500, color: stop.color, lineHeight: 1.55, marginBottom: 18 }}>
          {stop.headline}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {stop.facts.map((fact, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ fontFamily: MONO, fontSize: 9, color: stop.color, flexShrink: 0, marginTop: 2, letterSpacing: '0.05em' }}>
                {String(i + 1).padStart(2, '0')}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: C.text2, lineHeight: 1.6 }}>{fact}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── LayerPanel ────────────────────────────────────────────────────────────────
function LayerPanel({ open, showDataCenters, onToggleDC, showPlants, onTogglePlants,
  showPlanned, onTogglePlanned,
  activeFuels, onToggleFuel, topOffset, onClose }: {
  open: boolean;
  showDataCenters: boolean; onToggleDC: () => void;
  showPlants: boolean;      onTogglePlants: () => void;
  showPlanned: boolean;     onTogglePlanned: () => void;
  activeFuels: Set<string>; onToggleFuel: (f: FuelKey) => void;
  topOffset: number; onClose:()=>void;
}) {
  if(!open)return null;
  const FUEL_ROWS: { key: FuelKey; label: string }[] = [
    { key: 'coal',        label: 'Coal'        },
    { key: 'natural_gas', label: 'Natural Gas' },
    { key: 'nuclear',     label: 'Nuclear'     },
    { key: 'solar',       label: 'Solar'       },
    { key: 'wind',        label: 'Wind'        },
    { key: 'hydro',       label: 'Hydro'       },
  ];

  const allFuelsOn  = ALL_FUELS.every(f => activeFuels.has(f));
  const someFuelsOn = ALL_FUELS.some(f => activeFuels.has(f));

  return (
    <aside className="layer-panel" aria-label="Map layer controls" onKeyDown={e=>{if(e.key==='Escape')onClose()}} style={{
      position: 'absolute', top: topOffset, right: 0,
      width: 272,
      height: `calc(100% - ${topOffset}px)`,
      background: C.surface,
      borderLeft: `1px solid ${C.border}`,
      zIndex: 45,
      transform: open ? 'translateX(0)' : 'translateX(272px)',
      transition: 'transform 0.28s cubic-bezier(0.22,1,0.36,1), top 0.22s cubic-bezier(0.22,1,0.36,1), height 0.22s cubic-bezier(0.22,1,0.36,1)',
      overflowY: 'auto',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Panel header */}
      <div style={{
        padding: '14px 20px 12px',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.text3 }}>
          Display layers
        </div><button className="close-layer-mobile" onClick={onClose} aria-label="Close map layers" style={{background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:6,padding:"8px 12px",cursor:"pointer"}}>×</button>
        <div style={{ fontFamily: MONO, fontSize: 9, color: C.text3 }}>
          {[showDataCenters && 'DC', showPlants && someFuelsOn && 'Plants'].filter(Boolean).join(' · ') || 'Inventory layers off'}
        </div>
      </div>

      {/* Section: Data layers */}
      <div style={{ padding: '14px 20px 10px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.text3, marginBottom: 6 }}>
          Layers
        </div>

        <Toggle label="Data Centers" on={showDataCenters} onChange={onToggleDC} />
        <Toggle label="Power Plants" on={showPlants} onChange={onTogglePlants} />
        <Toggle
          label="Future projects · unverified"
          sublabel="Inherited planned / construction labels; not a complete pipeline"
          on={showPlanned}
          onChange={onTogglePlanned}
        />

      </div>

      {/* Section: Fuel type filter */}
      <div style={{
        padding: '14px 20px 12px',
        borderBottom: `1px solid ${C.border}`,
        flexShrink: 0,
        display: showPlants ? 'block' : 'none',
        transition: 'opacity 0.2s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.text3 }}>
            Fuel Types
          </div>
          <button
            onClick={() => {
              if (!showPlants) return;
              if (allFuelsOn) ALL_FUELS.forEach(f => activeFuels.has(f) && onToggleFuel(f));
              else ALL_FUELS.forEach(f => !activeFuels.has(f) && onToggleFuel(f));
            }}
            style={{
              fontFamily: MONO, fontSize: 8, letterSpacing: '0.1em',
              padding: '3px 8px', borderRadius: 3,
              border: `1px solid ${C.border}`, background: 'transparent',
              color: C.text3, cursor: showPlants ? 'pointer' : 'default',
              textTransform: 'uppercase',
            }}
          >
            {allFuelsOn ? 'None' : 'All'}
          </button>
        </div>
        {FUEL_ROWS.map(f => (
          <FuelCheckbox
            key={f.key}
            color={FUEL[f.key]}
            label={f.label}
            checked={activeFuels.has(f.key)}
            onChange={() => onToggleFuel(f.key)}
            disabled={!showPlants}
          />
        ))}
      </div>


    </aside>
  );
}

// ── SearchOverlay ─────────────────────────────────────────────────────────────
function SearchOverlay({ dcs, plants, onSelectDc, onSelectPlant, onClose }: {
  dcs: DataCenter[]; plants: any[];
  onSelectDc: (dc: DataCenter) => void;
  onSelectPlant: (p: any) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [hi, setHi]       = useState(-1);
  const inputRef          = useRef<HTMLInputElement>(null);
  const listRef           = useRef<HTMLDivElement>(null);

  const results = useMemo(() => searchAll(query, dcs, plants), [query, dcs, plants]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setHi(-1); }, [results]);

  useEffect(() => {
    if (hi < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${hi}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  const select = (r: SearchResult) => {
    if (r.kind === 'dc') onSelectDc(r.payload as DataCenter);
    else onSelectPlant(r.payload);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi(h => (h + 1) % Math.max(results.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi(h => (h <= 0 ? results.length - 1 : h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (hi >= 0 && hi < results.length) select(results[hi]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const showNoResults = query.trim().length >= 2 && results.length === 0;
  const hasResults    = results.length > 0;
  const firstPlantIdx = results.findIndex(r => r.kind === 'plant');

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 59,
        background: 'rgba(4,14,31,0.6)', backdropFilter: 'blur(3px)',
      }} />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 62, left: '50%', zIndex: 60,
        transform: 'translateX(-50%)',
        width: 'min(600px, calc(100vw - 32px))',
        animation: 'searchSlideDown 0.18s ease-out',
      }}>
        <style>{`@keyframes searchSlideDown { from { opacity:0; transform:translateX(-50%) translateY(-8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`}</style>

        {/* Input row */}
        <div style={{
          background: C.surface2, border: `1px solid ${C.border2}`,
          borderRadius: hasResults || showNoResults ? '8px 8px 0 0' : 8,
          display: 'flex', alignItems: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
        }}>
          <div style={{ padding: '0 14px 0 16px', color: C.text3, display: 'flex', flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="10.5" y1="10.5" x2="13.5" y2="13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search facilities, operators, states…"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontFamily: SANS, fontSize: 15, color: C.text,
              padding: '14px 0',
            }}
          />
          <div style={{ padding: '0 14px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            {query ? (
              <button onClick={() => { setQuery(''); inputRef.current?.focus(); }} style={{
                background: 'transparent', border: 'none', padding: '2px 4px',
                color: C.text3, cursor: 'pointer', fontFamily: MONO, fontSize: 11, lineHeight: 1,
              }}>✕</button>
            ) : (
              <span style={{ fontFamily: MONO, fontSize: 9, color: C.text3, letterSpacing: '0.06em', opacity: 0.6 }}>ESC</span>
            )}
          </div>
        </div>

        {/* Results list */}
        {hasResults && (
          <div ref={listRef} style={{
            background: C.surface, border: `1px solid ${C.border2}`, borderTop: `1px solid ${C.border}`,
            borderRadius: '0 0 8px 8px', maxHeight: 400, overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
          }}>
            {results.map((r, i) => {
              const isPlantSection = i === firstPlantIdx && firstPlantIdx > 0;
              const dotColor = r.kind === 'dc'
                ? (r.payload.status === 'under_construction' ? AMBER : r.payload.status === 'planned' ? LAVENDER : getMixColor(r.payload.power_mix))
                : (FUEL[r.payload.fuel_type] || FUEL.other);
              return (
                <div key={r.id}>
                  {isPlantSection && (
                    <div style={{
                      padding: '6px 16px', background: C.surface2,
                      fontFamily: MONO, fontSize: 8, letterSpacing: '0.18em',
                      textTransform: 'uppercase', color: C.text3,
                      borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`,
                    }}>
                      Power Plants
                    </div>
                  )}
                  <div
                    data-idx={i}
                    onClick={() => select(r)}
                    onMouseEnter={() => setHi(i)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 16px', cursor: 'pointer',
                      background: i === hi ? C.surface3 : 'transparent',
                      borderTop: i > 0 && i !== firstPlantIdx ? `1px solid ${C.border}` : 'none',
                      transition: 'background 0.08s',
                    }}
                  >
                    {/* Dot icon */}
                    <div style={{
                      width: 8, height: 8, flexShrink: 0,
                      borderRadius: r.kind === 'dc' ? '50%' : 2,
                      background: r.kind === 'dc' && r.payload.status !== 'operational'
                        ? 'transparent' : dotColor,
                      border: r.kind === 'dc' && r.payload.status !== 'operational'
                        ? `2px solid ${dotColor}` : 'none',
                      boxShadow: `0 0 6px ${dotColor}80`,
                    }} />
                    {/* Text */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: SANS, fontSize: 13, fontWeight: 600, color: C.text,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{r.name}</div>
                      {r.secondary && (
                        <div style={{
                          fontFamily: MONO, fontSize: 10, color: C.text3, marginTop: 1,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          textTransform: r.kind === 'plant' ? 'capitalize' : 'none',
                        }}>{r.secondary}</div>
                      )}
                    </div>
                    {/* State */}
                    <div style={{ fontFamily: MONO, fontSize: 9, color: C.text3, flexShrink: 0, letterSpacing: '0.06em' }}>
                      {r.state}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {showNoResults && (
          <div style={{
            background: C.surface, border: `1px solid ${C.border2}`,
            borderTop: `1px solid ${C.border}`, borderRadius: '0 0 8px 8px',
            padding: '18px 16px', textAlign: 'center',
            fontFamily: MONO, fontSize: 11, color: C.text3,
            boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
          }}>
            No results for <span style={{ color: C.text2 }}>"{query}"</span>
          </div>
        )}
      </div>
    </>
  );
}

// ── SplashScreen ──────────────────────────────────────────────────────────────
const SPLASH_STATS = [
  { num: '1,499',  desc: 'retained inventory locations; not a national census', accent: C.green  },
  { num: '26', desc: 'US reporting locations with 2025 water disclosures', accent: '#9A6B1E' },
  { num: '3', desc: 'reporting locations with documented water-source references', accent: C.green },
] as const;

function SplashScreen({ fading, onDismiss }: { fading: boolean; onDismiss: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: `radial-gradient(ellipse 1100px 800px at 50% 44%, ${C.surface2} 0%, ${C.bg} 100%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '40px 24px',
      opacity: fading ? 0 : 1,
      transition: 'opacity 0.5s ease',
      animation: 'splashIn 0.4s ease-out',
    }}>
      <style>{`
        @keyframes splashIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .splash-cta:hover { filter: brightness(1.1); }
      `}</style>

      <div style={{ maxWidth: 520, width: '100%' }}>

        {/* Tag line */}
        <div style={{
          fontFamily: MONO, fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase',
          color: C.text3, marginBottom: 28,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ width: 20, height: 1, background: C.border2 }} />
          PNNL IM3 Atlas · EIA 860/923 · Interactive
        </div>

        {/* Title */}
        <div style={{ marginBottom: 18 }}>
          <div style={{
            fontFamily: SANS, fontSize: 54, fontWeight: 900,
            letterSpacing: '-0.04em', lineHeight: 1.0, color: C.text,
          }}>
            US Data Center
          </div>
          <div style={{
            fontFamily: SANS, fontSize: 54, fontWeight: 900,
            letterSpacing: '-0.04em', lineHeight: 1.0, color: C.text2,
          }}>
            Resource Map
          </div>
        </div>

        {/* Subtitle */}
        <div style={{
          fontFamily: MONO, fontSize: 13, color: C.orange,
          letterSpacing: '-0.005em', lineHeight: 1.5, marginBottom: 36,
        }}>
          Locations · water disclosures · evidence
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: C.border, marginBottom: 28 }} />

        {/* Stats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
          {SPLASH_STATS.map(({ num, desc, accent }) => (
            <div key={num} style={{
              display: 'flex', alignItems: 'center', gap: 20,
              padding: '14px 16px 14px 20px',
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderLeft: `3px solid ${accent}`,
              borderRadius: 6,
            }}>
              <div style={{
                fontFamily: MONO, fontSize: 28, fontWeight: 700, color: C.text,
                letterSpacing: '-0.03em', lineHeight: 1, flexShrink: 0, minWidth: 88,
              }}>
                {num}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: C.text2, lineHeight: 1.6 }}>
                {desc}
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <button
          className="splash-cta"
          onClick={onDismiss}
          style={{
            width: '100%', padding: '15px 24px',
            fontFamily: SANS, fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em',
            background: C.green, color: C.bg,
            border: 'none', borderRadius: 7, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            boxShadow: `0 0 48px ${C.green}28`,
            transition: 'filter 0.15s',
          }}
        >
          Explore the map
          <span style={{ fontSize: 17 }}>→</span>
        </button>

        {/* Attribution */}
        <div style={{
          fontFamily: MONO, fontSize: 9, color: C.text3,
          textAlign: 'center', marginTop: 16, letterSpacing: '0.06em',
        }}>
          Research preview · incomplete coverage · source dates vary
        </div>
      </div>
    </div>
  );
}

// ── AboutPanel ────────────────────────────────────────────────────────────────
type AboutSource = { name: string; version: string; count: string; desc: string; url: string | null; urlLabel: string | null };
const ABOUT_SOURCES: AboutSource[] = [
  {
    name: 'PNNL IM3 Atlas',
    version: 'Checked Oct 16, 2026',
    count: '1,499 retained records; 1,382 upstream locations checked',
    desc: 'Retained inventory derived from the PNNL atlas, with local enrichment. The October check compared geographic coverage only; operator, status, utility, and contract fields are not independently verified.',
    url: 'https://im3.pnnl.gov/datacenter-atlas',
    urlLabel: 'PNNL IM3 source atlas',
  },
  {
    name: 'EIA Form 860',
    version: '2023 release',
    count: '11,159 displayed plant records',
    desc: 'Local plant records labeled as EIA-derived 2023 data. Six fuel categories are displayed (11,159 of 14,793 records). Original EIA plant identifiers and row-level source lineage are absent, so unique plant identity and current operating status are unverified.',
    url: 'https://www.eia.gov/electricity/data/eia860/',
    urlLabel: 'eia.gov · electricity/data/eia860',
  },
  {
    name: 'EIA Form 923',
    version: '2023 release',
    count: 'Generation & fuel data',
    desc: 'Reference only. No reproducible Form 923 cross-validation is present in this repository; generation or measured campus emissions are not displayed.',
    url: 'https://www.eia.gov/electricity/data/eia923/',
    urlLabel: 'eia.gov · electricity/data/eia923',
  },
  {
    name: 'Hand-curated Emerging Campuses',
    version: '2023–2026',
    count: '20 unverified inventory entries',
    desc: 'Inherited planned and construction records without per-record citations in this repository. Hidden by default; these entries need source and status verification.',
    url: null,
    urlLabel: null,
  },
];

const ABOUT_LIMITATIONS = [
  'Water use covers 26 Google reporting locations, with 16 representative map locations. Daily values are annual averages, not live meters. Risk overlays have been withheld because their former geometry and scores were illustrative.',
  'Campus electricity mix, PPA claims, demand heuristics, and modeled emissions have been withheld pending reproducible evidence.',
  'Utility mapping and power mix may be missing or use state-level fallbacks; coverage is not independently validated.',
  'Facility positions and statuses vary in accuracy. A dataset coverage check does not verify each record’s identity, current operation, or nationwide completeness.',
  '"Nearby plant records" shows the 3 plants selected by an approximate latitude/longitude distance as a visual heuristic only — not actual grid topology.',
  'Emerging campuses are unverified inherited announcements and are hidden by default. Projects may be delayed, changed, or cancelled.',
  'Only six plant fuel categories are displayed; excluded records and absent plant identifiers limit completeness and deduplication.',
] as const;

function AboutPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  if(!open)return null;
  return (
    <div style={{
      position: 'absolute', top: 56, right: 0,
      width: 320, height: 'calc(100% - 56px)',
      background: C.surface, borderLeft: `1px solid ${C.border}`,
      zIndex: 14,
      transform: open ? 'translateX(0)' : 'translateX(320px)',
      transition: 'transform 0.28s cubic-bezier(0.22,1,0.36,1)',
      overflowY: 'auto', display: 'flex', flexDirection: 'column',
      fontFamily: SANS,
    }}>

      {/* Sticky header */}
      <div style={{
        padding: '14px 20px 12px', borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, position: 'sticky', top: 0,
        background: C.surface, zIndex: 1,
      }}>
        <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.text3 }}>
          Methodology &amp; About
        </div>
        <button onClick={onClose} style={{
          width: 26, height: 26, background: C.surface3,
          border: `1px solid ${C.border}`, color: C.text2, cursor: 'pointer',
          borderRadius: 5, fontSize: 16, lineHeight: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SANS,
        }}>×</button>
      </div>

      {/* Data sources */}
      <div style={{ padding: '16px 20px 14px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.text3, marginBottom: 14 }}>
          Data Sources
        </div>
        {ABOUT_SOURCES.map((s, i) => (
          <div key={s.name} style={{ marginBottom: i < ABOUT_SOURCES.length - 1 ? 18 : 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{s.name}</span>
              <span style={{ fontFamily: MONO, fontSize: 9, color: C.text3 }}>{s.version}</span>
            </div>
            <div style={{ fontFamily: MONO, fontSize: 9, color: C.green, letterSpacing: '0.06em', marginBottom: 5 }}>
              {s.count}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.text3, lineHeight: 1.65 }}>
              {s.desc}
            </div>
            {s.url && (
              <a href={s.url} target="_blank" rel="noopener noreferrer" style={{
                fontFamily: MONO, fontSize: 9, color: C.text2, textDecoration: 'none',
                display: 'inline-block', marginTop: 6,
                borderBottom: `1px solid ${C.border2}`, letterSpacing: '0.04em',
              }}>
                ↗ {s.urlLabel}
              </a>
            )}
          </div>
        ))}
      </div>

      {/* Methodology */}
      <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.text3, marginBottom: 12 }}>
          Methodology
        </div>
        {([
          ['Evidence', 'Reported disclosures, inherited inventory fields, and geographic context are distinct. Missing values are not zero. See the public evidence register for lineage and coverage.'],
          ['Demand and emissions', 'Campus demand totals and modeled plant emissions were removed. No measured campus electricity or emissions series is available in this dataset.'],
          ['Nearby plants', 'Lines indicate geographic proximity only. They do not identify a campus electricity supplier or physical grid connection.'],
        ] as [string, string][]).map(([title, body]) => (
          <div key={title} style={{ marginBottom: 12 }}>
            <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, color: C.text2, marginBottom: 3 }}>{title}</div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.text3, lineHeight: 1.65 }}>{body}</div>
          </div>
        ))}
      </div>

      {/* Known limitations */}
      <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.text3, marginBottom: 10 }}>
          Known Limitations
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {ABOUT_LIMITATIONS.map((lim, i) => (
            <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
              <span style={{ fontFamily: MONO, fontSize: 9, color: AMBER, flexShrink: 0, marginTop: 1 }}>▲</span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: C.text3, lineHeight: 1.6 }}>{lim}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Update cadence */}
      <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.text3, marginBottom: 10 }}>
          Update Cadence
        </div>
        {([
          ['Base dataset', 'Manual review; no scheduled refresh'],
          ['Power plants', '2023 snapshot; newer releases not imported'],
          ['Emerging DCs', 'Unverified legacy records; hidden by default'],
          ['Risk overlays', 'Withheld pending verified data'],
        ] as [string, string][]).map(([label, value]) => (
          <div key={label} style={{ display: 'flex', gap: 8, marginBottom: 7, alignItems: 'flex-start' }}>
            <span style={{ fontFamily: MONO, fontSize: 9, color: C.text2, flexShrink: 0, width: 108 }}>{label}</span>
            <span style={{ fontFamily: MONO, fontSize: 9, color: C.text3, lineHeight: 1.5 }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Author */}
      <div style={{ padding: '16px 20px 24px', marginTop: 'auto', flexShrink: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.text3, marginBottom: 10 }}>
          Built by
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.text, letterSpacing: '-0.025em', marginBottom: 6 }}>
          Kevin Clark
        </div>
        <a href="https://kevinclark.ai" target="_blank" rel="noopener noreferrer" style={{
          fontFamily: MONO, fontSize: 10, color: C.green, textDecoration: 'none',
          display: 'inline-flex', alignItems: 'center', gap: 5,
          borderBottom: `1px solid ${C.green}40`,
        }}>
          kevinclark.ai ↗
        </a>
        <div style={{
          fontFamily: MONO, fontSize: 10, color: C.text3, lineHeight: 1.7,
          marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}`,
        }}>
          This map exists to make the energy infrastructure story behind AI visible. The scale of compute being deployed — and its implications for the US power grid — deserves public scrutiny.
        </div>
      </div>
    </div>
  );
}

// ── StatsStrip ────────────────────────────────────────────────────────────────
function StatsStrip({ stats, expanded }: { stats: MapStats; expanded: boolean }) {
  const items: [string, string, string][] = [
    ['INVENTORY LOCATIONS IN VIEW',stats.totalDCs.toLocaleString(),C.text2],
    ['PLANT RECORDS IN VIEW',stats.plantCount.toLocaleString(),C.text2],
  ];
  return (
    <div style={{
      position: 'absolute', top: 86, left: 0, right: 0,
      height: expanded ? 30 : 0,
      overflow: 'hidden',
      background: C.surface2,
      borderBottom: `1px solid ${C.border}`,
      zIndex: 9,
      transition: 'height 0.22s cubic-bezier(0.22,1,0.36,1)',
      display: 'flex', alignItems: 'center',
      padding: '0 24px', gap: 0,
    }}>
      {items.map(([label, value, color], i) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {i > 0 && <div style={{ width: 1, height: 12, background: C.border2, margin: '0 14px', flexShrink: 0 }} />}
          <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color, marginRight: 4 }}>{value}</span>
          <span style={{ fontFamily: MONO, fontSize: 8, color: C.text3, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</span>
        </div>
      ))}
      <div style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 8, color: C.text3, letterSpacing: '0.08em', opacity: 0.5, flexShrink: 0 }}>
        Geographic counts · not demand
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DataCenterMap() {
  const mapContainer     = useRef<HTMLDivElement>(null);
  const map              = useRef<MapboxMap | null>(null);
  const tourActive       = useRef(false);
  const tourTimers       = useRef<ReturnType<typeof setTimeout>[]>([]);
  const dcAllFeatures    = useRef<GeoJSON.Feature[]>([]);
  const dcPpaFeatures    = useRef<GeoJSON.Feature[]>([]);
  const plannedFeatures  = useRef<GeoJSON.Feature[]>([]);
  const allDcData        = useRef<DataCenter[]>([]);
  const allPlantsData    = useRef<any[]>([]);
  const electronAnimRef  = useRef<number | null>(null);

  const initialView=useRef(parseView(window.location.search)).current;
  const [mode,setMode]=useState(initialView.mode);
  const [facilityTab,setFacilityTab]=useState<FacilityTab>(initialView.tab as FacilityTab);
  const [viewReady,setViewReady]=useState(false);
  const [selected,      setSelected]      = useState<DataCenter | null>(null);
  const [total,         setTotal]         = useState(0);
  const [loaded,        setLoaded]        = useState(false);
  const [context,       setContext]       = useState<{ count: number; region: string } | null>(null);
  const [tourRunning,   setTourRunning]   = useState(false);
  const [tourStopIndex, setTourStopIndex] = useState<number | null>(null);
  // Layer panel state
  const [layerPanelOpen,  setLayerPanelOpen]  = useState(false);
  const [aboutOpen,       setAboutOpen]       = useState(false);
  const [showDataCenters, setShowDataCenters] = useState(initialView.centers);
  const [showPlants,      setShowPlants]      = useState(initialView.plants);
  const [activeFuels,     setActiveFuels]     = useState<Set<FuelKey>>(new Set(initialView.fuels as FuelKey[]));
  const [showPlanned,     setShowPlanned]     = useState(initialView.planned);
  const [waterOpen, setWaterOpen] = useState(false);
  const [gridLayer,setGridLayer]=useState(initialView.grid||'none');
  const [gridOpen,setGridOpen]=useState(initialView.mode==='grid'&&!initialView.facility);
  const [gridStatus,setGridStatus]=useState('');
  const [comparison,setComparison]=useState<DataCenter[]>([]);
  const [compareOpen,setCompareOpen]=useState(false);
  const [registerOpen,setRegisterOpen]=useState(false);
  const [waterMode,setWaterMode] = useState(initialView.mode==='water');
  const [watershedLevel,setWatershedLevel] = useState(initialView.watershed);
  const [watershedsReady,setWatershedsReady] = useState(false);
  const [searchOpen,      setSearchOpen]      = useState(false);
  const [loadError,setLoadError] = useState(false);
  const [showElectrons,   setShowElectrons]   = useState(false);
  // Stats strip
  const [stats,           setStats]           = useState<MapStats | null>(null);
  const [statsExpanded,   setStatsExpanded]   = useState(false);
  // Splash state
  const [splashVisible,setSplashVisible]=useState(false);
  const [splashFading,    setSplashFading]    = useState(false);

  // ── Map layer sync effects ─────────────────────────────────────────────────
  useEffect(() => {
    if (!loaded || !map.current) return;
    const vis = showDataCenters ? 'visible' : 'none';
    ['clusters-glow', 'clusters', 'cluster-count', 'unclustered-glow', 'unclustered'].forEach(l => {
      if (map.current?.getLayer(l)) map.current!.setLayoutProperty(l, 'visibility', vis);
    });
  }, [loaded, showDataCenters]);

  useEffect(() => {
    if (!loaded || !map.current) return;
    const vis = showPlants ? 'visible' : 'none';
    ['plants-glow', 'plants'].forEach(l => {
      if (map.current?.getLayer(l)) map.current!.setLayoutProperty(l, 'visibility', vis);
    });
  }, [loaded, showPlants]);

  useEffect(() => {
    if (!loaded || !map.current) return;
    const allActive = ALL_FUELS.every(f => activeFuels.has(f));
    const filter: any = allActive ? null : ['in', ['get', 'fuel_type'], ['literal', Array.from(activeFuels)]];
    ['plants-glow', 'plants'].forEach(l => {
      if (map.current?.getLayer(l)) map.current!.setFilter(l, filter);
    });
  }, [loaded, activeFuels]);



  useEffect(() => {
    if (!loaded || !map.current) return;
    const vis = showPlanned ? 'visible' : 'none';
    ['emerging-uc-glow', 'emerging-uc', 'emerging-planned-glow', 'emerging-planned'].forEach(l => {
      if (map.current?.getLayer(l)) map.current!.setLayoutProperty(l, 'visibility', vis);
    });
  }, [loaded, showPlanned]);





  useEffect(() => {
    if (!loaded || !map.current) return;
    const m=map.current;
    for(const id of ['water-reports','water-report-labels'])if(m.getLayer(id)){m.setLayoutProperty(id,'visibility',waterMode?'visible':'none');m.moveLayer(id);}
    for(const id of ['watersheds-fill','watersheds-line']) if(m.getLayer(id)) {
      m.setLayoutProperty(id,'visibility',waterMode && watershedLevel?'visible':'none');
      m.setFilter(id,['==',['get','level'],watershedLevel]);
    }
  },[loaded,waterMode,watershedLevel,watershedsReady]);

  useEffect(()=>{
    if(!loaded||!waterMode||watershedsReady||!map.current?.getLayer('water-reports'))return;
    const controller=new AbortController();
      fetch('/watersheds.json',{signal:controller.signal}).then(r=>{if(!r.ok)throw Error('Watershed data unavailable');return r.json()}).then(boundaries=>{
        if(!map.current||controller.signal.aborted)return;
        const seenWatersheds=new Set<string>();
        boundaries.features=boundaries.features.filter((feature:any)=>{const key=String(feature.properties.huc);if(seenWatersheds.has(key))return false;seenWatersheds.add(key);return true;});
        map.current.addSource('watersheds',{type:'geojson',data:boundaries,attribution:'USGS Watershed Boundary Dataset'});
        map.current.addLayer({id:'watersheds-fill',type:'fill',source:'watersheds',layout:{visibility:'none'},filter:['==',['get','level'],8],paint:{'fill-color':'#245D62','fill-opacity':0.035}},'water-reports');
        map.current.addLayer({id:'watersheds-line',type:'line',source:'watersheds',layout:{visibility:'none'},filter:['==',['get','level'],8],paint:{'line-color':'#476c63','line-width':1.1,'line-dasharray':[4,3]}},'water-reports');
        setWatershedsReady(true);
      }).catch(error=>{if(error.name!=='AbortError')console.warn('Watershed context could not load')});
    return()=>controller.abort();
  },[loaded,waterMode,watershedsReady]);

  useEffect(()=>{
    if(!loaded||!map.current)return;
    const m=map.current;
    const data:GeoJSON.FeatureCollection={type:'FeatureCollection',features:selected?[{type:'Feature',geometry:{type:'Point',coordinates:[selected.lon,selected.lat]},properties:{}}]:[]};
    if(!m.getSource('selected-campus')){
      m.addSource('selected-campus',{type:'geojson',data});
      m.addLayer({id:'selected-halo',type:'circle',source:'selected-campus',paint:{'circle-radius':13,'circle-color':'#FAFAF7','circle-opacity':0.85,'circle-stroke-width':1.5,'circle-stroke-color':'#303A39'}});
      m.addLayer({id:'selected-point',type:'circle',source:'selected-campus',paint:{'circle-radius':4,'circle-color':'#303A39'}});
    }else(m.getSource('selected-campus') as GeoJSONSource).setData(data);
    m.moveLayer('selected-halo');m.moveLayer('selected-point');
  },[loaded,selected,waterMode,watershedsReady]);

  useEffect(()=>{
    if(!loaded||!map.current)return;
    const m=map.current;let active=true;
    if(gridLayer==='none'){for(const id of ['grid-boundary-fill','grid-boundary-line'])if(m.getLayer(id))m.setLayoutProperty(id,'visibility','none');setGridStatus('');return;}
    for(const id of ['grid-boundary-fill','grid-boundary-line'])if(m.getLayer(id))m.setLayoutProperty(id,'visibility','none');
    setGridStatus('Loading historical grid boundaries…');
    loadGrid(gridLayer).then(data=>{if(!active||!map.current)return;
      if(m.getSource('grid-context'))(m.getSource('grid-context') as GeoJSONSource).setData(data);
      else{m.addSource('grid-context',{type:'geojson',data});m.addLayer({id:'grid-boundary-fill',type:'fill',source:'grid-context',paint:{'fill-color':'#776689','fill-opacity':0.055}},'clusters');m.addLayer({id:'grid-boundary-line',type:'line',source:'grid-context',paint:{'line-color':'#776689','line-width':1.5}},'clusters');}
      for(const id of ['grid-boundary-fill','grid-boundary-line'])m.setLayoutProperty(id,'visibility','visible');setGridStatus('');
    }).catch(()=>{if(active)setGridStatus('Grid boundaries unavailable. Choose Off, then retry. Other layers remain available.')});
    return()=>{active=false};
  },[loaded,gridLayer]);

  const syncView=()=>{if(!map.current||!viewReady)return;const center=map.current.getCenter();const query=serializeView({mode,grid:gridLayer,tab:facilityTab,facility:selected?.id||null,lon:center.lng,lat:center.lat,zoom:map.current.getZoom(),watershed:watershedLevel,plants:showPlants,centers:showDataCenters,planned:showPlanned,fuels:[...activeFuels]});window.history.replaceState(null,'',`${window.location.pathname}?${query}`);};
  useEffect(()=>{syncView();},[viewReady,mode,gridLayer,facilityTab,selected,watershedLevel,showPlants,showDataCenters,showPlanned,activeFuels]);
  useEffect(()=>{if(!map.current||!viewReady)return;map.current.on('moveend',syncView);return()=>{map.current?.off('moveend',syncView)}},[viewReady,mode,gridLayer,facilityTab,selected,watershedLevel,showPlants,showDataCenters,showPlanned,activeFuels]);
  const switchMode=(next:string)=>{setRegisterOpen(false);setCompareOpen(false);setMode(next);setGridOpen(next==='grid'&&!selected);if(next==='grid'&&selected)setFacilityTab('grid');setWaterMode(next==='water');setWaterOpen(false);setShowDataCenters(next!=='water');setShowPlants(next==='energy');setShowElectrons(false);setLayerPanelOpen(false);setAboutOpen(false);setStatsExpanded(false);if(next==='water'&&selected)setFacilityTab('water');};

  useEffect(()=>{
    const onResize=()=>{const m=map.current;if(!m)return;m.resize();if(selected)m.jumpTo({center:[selected.lon,selected.lat],padding:window.innerWidth>800?{top:90,bottom:90,left:40,right:370}:{top:110,bottom:360,left:20,right:20}});else m.setPadding({top:0,bottom:0,left:0,right:0});};
    window.addEventListener('resize',onResize);return()=>window.removeEventListener('resize',onResize);
  },[selected]);

  useEffect(()=>{if(selected){setRegisterOpen(false);setGridOpen(false);setWaterOpen(false);setCompareOpen(false)}},[selected]);

  // ── Electron lines ─────────────────────────────────────────────────────────
  const clearElectronLines = () => {
    if (electronAnimRef.current !== null) {
      cancelAnimationFrame(electronAnimRef.current);
      electronAnimRef.current = null;
    }
    if (!map.current) return;
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    (map.current.getSource('electron-lines')  as GeoJSONSource | undefined)?.setData(empty);
    (map.current.getSource('electron-labels') as GeoJSONSource | undefined)?.setData(empty);
  };

  const drawElectronLines = (dc: DataCenter) => {
    if (!map.current) return;
    clearElectronLines();
    const plants = findNearestPlants(dc.lat, dc.lon, allPlantsData.current, 3);
    if (!plants.length) return;

    const startTime = performance.now();
    const duration  = 1000;
    let labelsShown = false;

    const animate = (now: number) => {
      if (!map.current) return;
      const progress = Math.min((now - startTime) / duration, 1);

      const lineFeats: GeoJSON.Feature[] = plants.map(p => ({
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [dc.lon, dc.lat],
            [dc.lon + (p.lon - dc.lon) * progress, dc.lat + (p.lat - dc.lat) * progress],
          ],
        },
        properties: { fuel_color: FUEL[p.fuel_type as FuelKey] || FUEL.other },
      }));
      (map.current.getSource('electron-lines') as GeoJSONSource).setData({
        type: 'FeatureCollection', features: lineFeats,
      });

      if (progress >= 0.98 && !labelsShown) {
        labelsShown = true;
        const labelFeats: GeoJSON.Feature[] = plants.map(p => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
          properties: {
            plant_name: (p.name || 'Power Plant').slice(0, 28),
            fuel_label: (p.fuel_type || 'other').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
            fuel_color: FUEL[p.fuel_type as FuelKey] || FUEL.other,
          },
        }));
        (map.current.getSource('electron-labels') as GeoJSONSource).setData({
          type: 'FeatureCollection', features: labelFeats,
        });
      }

      if (progress < 1) {
        electronAnimRef.current = requestAnimationFrame(animate);
      } else {
        electronAnimRef.current = null;
      }
    };

    electronAnimRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    if (!loaded) return;
    clearElectronLines();
    if (selected && showElectrons) drawElectronLines(selected);
  }, [loaded, selected, showElectrons]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tour logic ─────────────────────────────────────────────────────────────
  const clearTourTimers = () => { tourTimers.current.forEach(clearTimeout); tourTimers.current = []; };

  const endTour = () => {
    tourActive.current = false;
    clearTourTimers();
    setTourRunning(false);
    setTourStopIndex(null);
  };

  const flyToStop = (index:number)=>{
    if(!tourActive.current||!map.current)return;
    setTourStopIndex(index);
    map.current.flyTo({center:TOUR_STOPS[index].center,zoom:TOUR_STOPS[index].zoom,duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:1000,essential:false});
  };

  const startTour = () => {
    if (!map.current || !loaded) return;
    clearTourTimers();
    tourActive.current = true;
    setTourRunning(true);setWaterOpen(false);setAboutOpen(false);setSearchOpen(false);
    setSelected(null);
    setLayerPanelOpen(false);
    flyToStop(0);
  };

  const nextStop = () => {
    if (tourStopIndex === null) return;
    clearTourTimers();
    const next = tourStopIndex + 1;
    if (next < TOUR_STOPS.length) flyToStop(next); else endTour();
  };

  const dismissSplash = () => {
    try { localStorage.setItem('dc-map-splash-dismissed', '1'); } catch {}
    setSplashFading(true);
    setTimeout(() => { setSplashVisible(false); setSplashFading(false); }, 520);
  };

  const toggleFuel = (fuel: FuelKey) => {
    setActiveFuels(prev => {
      const next = new Set(prev);
      if (next.has(fuel)) next.delete(fuel); else next.add(fuel);
      return next;
    });
  };

  // ── Map init ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (map.current || !mapContainer.current) return;
    if (!MAPBOX_TOKEN) { console.warn('Mapbox token not configured: water disclosures remain available.'); return; }
    let disposed=false;
    const loadTimeout=window.setTimeout(()=>{if(!disposed&&!map.current?.isStyleLoaded())setLoadError(true)},20000);
    void import('mapbox-gl').then(async ({default:mapboxgl})=>{
    if(disposed||!mapContainer.current)return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    let baseStyle:any='mapbox://styles/mapbox/outdoors-v12';
    try {
      const response=await fetch(`https://api.mapbox.com/styles/v1/mapbox/outdoors-v12?access_token=${encodeURIComponent(MAPBOX_TOKEN)}`);
      if(!response.ok)throw Error('Base style unavailable');
      baseStyle=await response.json();
      for(const layer of baseStyle.layers||[]) {
        const id=layer.id;
        layer.paint ??= {}; layer.layout ??= {};
        const paint=(key:string,value:any)=>{layer.paint[key]=value};
        const layout=(key:string,value:any)=>{layer.layout[key]=value};
        if(layer.type==='background')paint('background-color','#ece9dc');
        if(layer.type==='symbol'&&/poi|transit|road-number|road-label|path-pedestrian|trail-label/.test(id))layout('visibility','none');
        if(layer.type==='fill') {
          if(/water/.test(id)){paint('fill-color','#b3cccd');paint('fill-opacity',1);}
          else if(/landcover/.test(id))paint('fill-color',['match',['get','class'],'wood','#d5dcc8','grass','#e0e4cf','crop','#e6e5d3','snow','#f8f7ef','#e8e7d7']);
          else if(/landuse|park|national/.test(id))paint('fill-color','#dce1cc');
          else if(/building/.test(id))paint('fill-color','#d0cdbd');
        }
        if(layer.type==='line') {
          if(/waterway/.test(id)){paint('line-color','#739fa8');paint('line-opacity',1);}
          else if(/road|bridge|tunnel/.test(id)){paint('line-color','#beb8a3');paint('line-opacity',0.4);}
          else if(/admin/.test(id))paint('line-color','#999e8e');
        }
        if(layer.type==='hillshade'){
          paint('hillshade-shadow-color','#747e66');paint('hillshade-highlight-color','#fff9e8');paint('hillshade-accent-color','#a4ac8c');paint('hillshade-exaggeration',0.4);
        }
      }
      baseStyle.transition={duration:0,delay:0};
    }catch{baseStyle='mapbox://styles/mapbox/outdoors-v12'}
    if(disposed||!mapContainer.current)return;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: baseStyle,
      center: [initialView.lon, initialView.lat], zoom: initialView.zoom,
      projection: 'mercator' as any,
      cooperativeGestures:true,
    });

    map.current.addControl(new mapboxgl.NavigationControl({showCompass:false}),'bottom-right');
    map.current.addControl(new mapboxgl.ScaleControl({maxWidth:120,unit:'imperial'}),'bottom-left');

    map.current.on('load', async () => {window.clearTimeout(loadTimeout);setLoadError(false); try {


      const [dcRes, plantsRes] = await Promise.all([
        fetch('/datacenters.json'),
        fetch('/powerplants.json'),
      ]);
      if(!dcRes.ok||!plantsRes.ok)throw Error("Inventory data failed to load");
      const json       = await dcRes.json();
      const plantsJson = await plantsRes.json();
      if(!Array.isArray(json.data)||!Array.isArray(plantsJson.plants))throw Error("Invalid inventory format");
      const data: DataCenter[] = json.data;
      allDcData.current     = data;
      allPlantsData.current = plantsJson.plants;
      setTotal(data.length);
      setLoaded(true);

      // Context bar
      const updateContext = () => {
        const bounds=map.current!.getBounds()!;
        const inView=(d:{lat:number;lon:number})=>Number.isFinite(d.lat)&&Number.isFinite(d.lon)&&bounds.contains([d.lon,d.lat]);
        const visibleInventory=data.filter(inView);
        const features=visibleInventory;
        const center = map.current!.getCenter();
        const zoom   = map.current!.getZoom();
        let region   = 'United States';
        if (zoom > 7) {
          const { lng, lat } = center;
          if      (lat > 38   && lat < 40   && lng > -78    && lng < -76  ) region = 'Northern Virginia';
          else if (lat > 37   && lat < 38.5 && lng > -122.6 && lng < -121.5) region = 'San Francisco Bay Area';
          else if (lat > 33   && lat < 34.5 && lng > -118.7 && lng < -117.5) region = 'Los Angeles';
          else if (lat > 40.4 && lat < 41   && lng > -74.5  && lng < -73.5) region = 'New York Metro';
          else if (lat > 29.5 && lat < 30.5 && lng > -95.8  && lng < -94.8) region = 'Houston';
          else if (lat > 32.5 && lat < 33.5 && lng > -97.5  && lng < -96.5) region = 'Dallas';
          else if (lat > 41.5 && lat < 42.2 && lng > -88    && lng < -87.3) region = 'Chicago';
          else if (lat > 25   && lat < 26.5 && lng > -80.5  && lng < -79.8) region = 'Miami';
          else if (lat > 33   && lat < 34   && lng > -112.5 && lng < -111.5) region = 'Phoenix';
          else if (lat > 47   && lat < 48   && lng > -122.5 && lng < -121.8) region = 'Seattle';
          else if (lat > 39.5 && lat < 40.2 && lng > -105.3 && lng < -104.5) region = 'Denver';
          else if (lat > 30   && lat < 31   && lng > -97.9  && lng < -97.4) region = 'Austin';
          else region = 'Local Area';
        } else if (zoom > 5) {
          const lng = center.lng;
          if (lng < -115) region = 'Western US';
          else if (lng < -100) region = 'Central US';
          else region = 'Eastern US';
        }
        setContext({ count: features.length, region });

        const plantCount=plantsJson.plants.filter((p:any)=>inView(p)&&ALL_FUELS.includes(p.fuel_type)).length;
        setStats({totalDCs:visibleInventory.length,mwDemand:0,co2Tons:0,plantCount,withPPA:0,withoutPPA:0});
      };
      map.current!.on('moveend', updateContext);
      map.current!.on('zoomend', updateContext);
      setTimeout(updateContext, 500);

      // Power plants
      const plantsGeojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: (plantsJson.plants as any[])
          .filter(p => p.lat && p.lon && ALL_FUELS.includes(p.fuel_type))
          .map(p => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
            properties: { name: p.name, state: p.state, fuel_type: p.fuel_type, capacity_mw: p.capacity_mw || 0 },
          })),
      };
      const fuelColorExpr: any = ['match', ['get', 'fuel_type'],
        'coal', FUEL.coal, 'natural_gas', FUEL.natural_gas, 'nuclear', FUEL.nuclear,
        'solar', FUEL.solar, 'wind', FUEL.wind, 'hydro', FUEL.hydro, FUEL.other,
      ];
      map.current!.addSource('plants', { type: 'geojson', data: plantsGeojson });
      map.current!.addLayer({ id: 'plants-glow', type: 'circle', source: 'plants', layout: { visibility: initialView.mode==='energy'?'visible':'none' },
        paint: { 'circle-color': fuelColorExpr, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 12, 6, 16, 10, 24], 'circle-opacity': 0.15, 'circle-blur': 1 },
      });
      map.current!.addLayer({ id: 'plants', type: 'circle', source: 'plants', layout: { visibility: initialView.mode==='energy'?'visible':'none' },
        paint: { 'circle-color': fuelColorExpr, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 6, 7, 9, 10, 13, 14, 18], 'circle-opacity': 0.9, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#000', 'circle-stroke-opacity': 0.5 },
      });

      // Data centers — split operational vs planned/under-construction
      const makeFeature = (d: DataCenter): GeoJSON.Feature => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
        properties: {
          ...d,
          power_mix:   JSON.stringify(d.power_mix),
          direct_ppas: JSON.stringify(d.direct_ppas),
          utility:     JSON.stringify(d.utility),
          _color:      getMixColor(d.power_mix),
          _has_ppas:   (d.direct_ppas?.length > 0) ? 1 : 0,
        },
      });
      const opData = data.filter((d: DataCenter) => d.lat && d.lon && d.status === 'operational');
      const allFeatures = opData.map(makeFeature);
      dcAllFeatures.current = allFeatures;
      dcPpaFeatures.current = allFeatures.filter(f => (f.properties as any)._has_ppas === 1);

      const emergingData = data.filter((d: DataCenter) => d.lat && d.lon && d.status !== 'operational');
      plannedFeatures.current = emergingData.map(makeFeature);

      const geojson: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: allFeatures };
      map.current!.addSource('datacenters', { type: 'geojson', data: geojson, cluster: true, clusterMaxZoom: 9, clusterRadius: 36 });

      const waterFeatures = WATER_RECORDS.flatMap(record => {
        const dc = data.find(d => record.facilityIds.includes(d.id));
        return dc ? [{type:'Feature' as const, geometry:{type:'Point' as const, coordinates:[dc.lon,dc.lat]}, properties:{facilityId:dc.id,location:record.location,daily:dailyGallons(record.consumptionMillionGallons,record.year)}}] : [];
      });
      map.current!.addSource('water-reports',{type:'geojson',data:{type:'FeatureCollection',features:waterFeatures}});
      map.current!.addLayer({id:'water-reports',type:'circle',source:'water-reports',layout:{visibility:'none'},paint:{'circle-radius':['interpolate',['linear'],['sqrt',['get','daily']],0,5,2000,38],'circle-color':'#245D62','circle-opacity':0.17,'circle-stroke-width':1.8,'circle-stroke-color':'#245D62'}});
      map.current!.addLayer({id:'water-report-labels',type:'symbol',source:'water-reports',minzoom:5.5,layout:{visibility:'none','text-field':['get','location'],'text-font':['DIN Offc Pro Medium','Arial Unicode MS Regular'],'text-size':11,'text-anchor':'top','text-offset':[0,2.8],'text-max-width':14},paint:{'text-color':'#17434b','text-halo-color':'#fbfaf5','text-halo-width':1.5}});
      map.current!.on('click','water-reports',e=>{const dc=data.find(d=>d.id===e.features?.[0].properties?.facilityId);if(dc)setSelected(dc);setFacilityTab('water');setWaterOpen(false);});
      map.current!.on('mouseenter','water-reports',()=>{map.current!.getCanvas().style.cursor='pointer';});
      map.current!.on('mouseleave','water-reports',()=>{map.current!.getCanvas().style.cursor='';});
      // Planned/under-construction DC source (no clustering — only 20 points)
      map.current!.addSource('planned-dcs', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: plannedFeatures.current },
      });
      map.current!.addLayer({ id: 'emerging-uc-glow', type: 'circle', source: 'planned-dcs',
        filter: ['==', ['get', 'status'], 'under_construction'], layout: { visibility: 'visible' },
        paint: { 'circle-color': AMBER, 'circle-radius': 16, 'circle-opacity': 0.18, 'circle-blur': 1 },
      });
      map.current!.addLayer({ id: 'emerging-uc', type: 'circle', source: 'planned-dcs',
        filter: ['==', ['get', 'status'], 'under_construction'], layout: { visibility: 'visible' },
        paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 9, 'circle-opacity': 1,
          'circle-stroke-width': 2.5, 'circle-stroke-color': AMBER, 'circle-stroke-opacity': 0.9 },
      });
      map.current!.addLayer({ id: 'emerging-planned-glow', type: 'circle', source: 'planned-dcs',
        filter: ['==', ['get', 'status'], 'planned'], layout: { visibility: 'visible' },
        paint: { 'circle-color': LAVENDER, 'circle-radius': 14, 'circle-opacity': 0.15, 'circle-blur': 1 },
      });
      map.current!.addLayer({ id: 'emerging-planned', type: 'circle', source: 'planned-dcs',
        filter: ['==', ['get', 'status'], 'planned'], layout: { visibility: 'visible' },
        paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 8, 'circle-opacity': 1,
          'circle-stroke-width': 2, 'circle-stroke-color': LAVENDER, 'circle-stroke-opacity': 0.8 },
      });

      map.current!.addLayer({ id: 'clusters-glow', type: 'circle', source: 'datacenters', filter: ['has', 'point_count'],
        paint: { 'circle-color': '#303A39', 'circle-radius': ['step', ['get', 'point_count'], 22, 10, 30, 50, 38], 'circle-opacity': 0.25, 'circle-blur': 0.6 },
      });
      map.current!.addLayer({ id: 'clusters', type: 'circle', source: 'datacenters', filter: ['has', 'point_count'],
        paint: { 'circle-color': '#303A39', 'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 50, 30], 'circle-opacity': 0.95, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#FAFAF7' },
      });
      map.current!.addLayer({ id: 'cluster-count', type: 'symbol', source: 'datacenters', filter: ['has', 'point_count'],
        layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 11, 'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'] },
        paint: { 'text-color': '#FAFAF7' },
      });
      map.current!.addLayer({ id: 'unclustered-glow', type: 'circle', source: 'datacenters', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': ['get', '_color'], 'circle-radius': 12, 'circle-opacity': 0.12, 'circle-blur': 1.2 },
      });
      map.current!.addLayer({ id: 'unclustered', type: 'circle', source: 'datacenters', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': ['get', '_color'], 'circle-radius': 7, 'circle-opacity': 1, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#000', 'circle-stroke-opacity': 0.6 },
      });

      // ── Electron line sources & layers (top of visual stack) ────────────────
      const emptyFC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
      map.current!.addSource('electron-lines',  { type: 'geojson', data: emptyFC });
      map.current!.addSource('electron-labels', { type: 'geojson', data: emptyFC });
      map.current!.addLayer({
        id: 'electron-lines-glow', type: 'line', source: 'electron-lines',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'fuel_color'], 'line-width': 9, 'line-opacity': 0.14, 'line-blur': 5 },
      });
      map.current!.addLayer({
        id: 'electron-lines-layer', type: 'line', source: 'electron-lines',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'fuel_color'], 'line-width': 2, 'line-opacity': 0.92, 'line-dasharray': [6, 4] },
      });
      map.current!.addLayer({
        id: 'electron-dots', type: 'circle', source: 'electron-labels',
        paint: {
          'circle-color': ['get', 'fuel_color'],
          'circle-radius': 6, 'circle-opacity': 1,
          'circle-stroke-width': 2, 'circle-stroke-color': '#FAFAF7', 'circle-stroke-opacity': 0.9,
        },
      });
      map.current!.addLayer({
        id: 'electron-labels-layer', type: 'symbol', source: 'electron-labels',
        layout: {
          'text-field': ['format',
            ['get', 'plant_name'], { 'font-scale': 0.95, 'text-font': ['literal', ['DIN Offc Pro Bold', 'Arial Unicode MS Bold']] },
            '\n', {},
            ['get', 'fuel_label'], { 'font-scale': 0.78, 'text-font': ['literal', ['DIN Offc Pro Medium', 'Arial Unicode MS Regular']] },
          ],
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
          'text-size': 11, 'text-anchor': 'left', 'text-offset': [1.0, 0],
          'text-allow-overlap': true, 'text-ignore-placement': true,
        },
        paint: {
          'text-color': ['get', 'fuel_color'],
          'text-halo-color': '#FAFAF7', 'text-halo-width': 1.5,
        },
      });

      map.current!.on('click', 'clusters', (e) => {
        const features  = map.current!.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        const clusterId = features[0].properties!.cluster_id;
        (map.current!.getSource('datacenters') as GeoJSONSource).getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return;
          map.current!.easeTo({ center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number], zoom: zoom! });
        });
      });
      const parseAndSelect = (props: any) => {
        setSelected({ ...props, power_mix: JSON.parse(props.power_mix), direct_ppas: JSON.parse(props.direct_ppas), utility: JSON.parse(props.utility) } as DataCenter);
      };
      map.current!.on('click', 'unclustered', (e) => parseAndSelect(e.features![0].properties!));
      map.current!.on('click', 'emerging-uc', (e) => parseAndSelect(e.features![0].properties!));
      map.current!.on('click', 'emerging-planned', (e) => parseAndSelect(e.features![0].properties!));
      map.current!.on('click', (e) => {
        const features = map.current!.queryRenderedFeatures(e.point, { layers: ['unclustered', 'clusters', 'emerging-uc', 'emerging-planned', 'water-reports'] });
        if (features.length === 0) setSelected(null);
      });
      ['clusters', 'unclustered', 'emerging-uc', 'emerging-planned'].forEach(layer => {
        map.current!.on('mouseenter', layer, () => { map.current!.getCanvas().style.cursor = 'pointer'; });
        map.current!.on('mouseleave', layer, () => { map.current!.getCanvas().style.cursor = ''; });
      });

      // ── Deep-link on load ────────────────────────────────────────────────────
      const facilityId = initialView.facility;
      if (facilityId) {
        const target = data.find((d: any) => d.id === facilityId);
        if (target?.lat && target?.lon) {
          setSelected(target as DataCenter);
          // Restore a shared camera exactly; legacy facility-only links center the campus.
          setTimeout(() => {
            if(!initialView.hasCamera)map.current?.jumpTo({center:[target.lon,target.lat],zoom:12});
          }, 400);
        }
      }

      setViewReady(true);
    } catch (err) { setLoadError(true);console.error('Map inventory could not load'); } });
    }).catch(()=>{if(!disposed)setLoadError(true)});
    return ()=>{disposed=true;tourActive.current=false;clearTourTimers();window.clearTimeout(loadTimeout);if(electronAnimRef.current!==null)cancelAnimationFrame(electronAnimRef.current);map.current?.remove();map.current=null;};
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="atlas-workspace" data-mode={mode} data-inspecting={Boolean(selected||waterOpen||gridOpen||compareOpen||registerOpen)} style={{ position: 'absolute', inset: 0, background: C.bg, fontFamily: SANS }}>

      {/* ── Header ── */}
      <header className="map-header product-header"><div><div className="product-brand"><strong>Compute Atlas</strong><a className="creator-link" href="https://kevinclark.ai">by Kevin Clark ↗</a></div></div>        <nav className="mode-nav" aria-label="Resource view">{['overview','energy','grid','water'].map(value=><button key={value} aria-pressed={mode===value} onClick={()=>switchMode(value)}>{value==='water'?'Water':value==='grid'?'Grid':value==='energy'?'Energy':'Facilities'}</button>)}</nav><div className="product-actions"><span className="coverage-caption">{loaded?`${total.toLocaleString()} inventory records · dates vary`:'Independent research preview'}</span><button aria-label="Search facilities" disabled={!loaded} onClick={()=>setSearchOpen(true)}>⌕ <span>Search</span></button><button className="rail-toggle" aria-label="Map layers" aria-expanded={layerPanelOpen} onClick={()=>{setLayerPanelOpen(v=>!v);setRegisterOpen(false);setWaterOpen(false);setGridOpen(false);setCompareOpen(false);}}>☷ <span>Layers</span></button><button className="register-launch" onClick={()=>{setRegisterOpen(v=>!v);setSelected(null);setGridOpen(false);setWaterOpen(false);setCompareOpen(false);setLayerPanelOpen(false)}}>Register</button><button className="compare-launch" onClick={()=>{setCompareOpen(v=>!v);setRegisterOpen(false);setWaterOpen(false);setGridOpen(false);setLayerPanelOpen(false)}}>Compare {comparison.length||""}</button><a href="/evidence" aria-label="Sources and evidence">Sources ↗</a><button aria-label="Map guide" aria-pressed={tourRunning} disabled={!loaded} onClick={()=>{setSelected(null);tourRunning?endTour():startTour();}}>?</button></div></header>

      <section className="investigation-intro" aria-label="Start a resource investigation"><p className="map-edition">{waterMode?"WATER / UNITED STATES":"US INFRASTRUCTURE / RESEARCH ATLAS"}</p><h1>{waterMode?<>Where does the<br/>water come from?</>:<>Data centers.<br/>Power. Water. Grid.</>}</h1><p>Independent infrastructure research for utilities, grid operators, developers, and researchers.</p>{!waterMode&&<button onClick={()=>{switchMode("grid");setGridOpen(true)}}>Explore grid context ↗</button>}<button className={waterMode?"":"secondary-investigation"} disabled={!loaded} onClick={()=>{const dc=allDcData.current.find(d=>d.id==='dc_pnnl_00171');if(dc){switchMode('water');setSelected(dc);setFacilityTab('water');map.current?.flyTo({center:[dc.lon,dc.lat],zoom:10.5,padding:window.innerWidth>800?{top:40,bottom:40,left:40,right:360}:{top:40,bottom:330,left:20,right:20}})}}}>Investigate The Dalles <span>↗</span></button><button className="intro-browse" onClick={()=>{switchMode('water');setGridOpen(false);setWaterOpen(true)}}>Browse water disclosures →</button></section>
      <div className="cartographic-key">{gridLayer!=="none"&&<p className="grid-map-date">Historical grid snapshot · {gridManifest.layers.find(l=>l.id===gridLayer)?.title}<br/>Source {gridManifest.layers.find(l=>l.id===gridLayer)?.sourceDates.join(" to ")} · not current connection evidence</p>}<div>{showDataCenters&&<><span className="key-location"/> Facility inventory</>}{showPlants&&<><span className="key-energy"/> Generation by fuel</>}{waterMode&&<><span className="key-water"/> Reported water use {Boolean(watershedLevel)&&<><span className="key-boundary"/> Campus watershed</>}</>}</div><p>{waterMode?'Circle size: annual-average daily consumption · 2025 disclosures':'Inventory locations and generation context · reporting dates vary'}</p><a href="/evidence">Research preview · reviewed Oct 18, 2026 · sources ↗</a></div>
      <aside className={`analysis-rail ${layerPanelOpen?'is-open':''}`} aria-label="Explore resources" onKeyDown={e=>{if(e.key==='Escape')setLayerPanelOpen(false)}}>
        <div className="rail-intro"><span className="rail-kicker">MAP CONTENTS</span><h2>Layers &amp; boundaries</h2><button className="rail-close" aria-label="Close resource controls" onClick={()=>setLayerPanelOpen(false)}>×</button></div>
        <button className="rail-search" disabled={!loaded} onClick={()=>setSearchOpen(true)}><span aria-hidden="true">⌕</span> Find a facility or power plant <span aria-hidden="true">↗</span></button>

        <div className="rail-view"><GridLayerSelect value={gridLayer} onChange={setGridLayer}/><button className="directory-action" onClick={()=>{setGridOpen(true);setSelected(null);setWaterOpen(false);setLayerPanelOpen(false)}}>Grid sources &amp; regional inventory →</button><p className="rail-note">Boundary snapshots are historical. Confirm operational roles and connection evidence separately.</p><h2>{waterMode?'Water systems':mode==='energy'?'Energy infrastructure':'Facility inventory'}</h2><p>{waterMode?'Reported use, documented sources, and campus drainage areas.':mode==='energy'?'Generation locations and fuel types. Proximity does not establish supply.':'Location inventory. Capacity and operator fields have uneven coverage.'}</p>
        {waterMode&&<><button className="directory-action" onClick={()=>{setSelected(null);setWaterOpen(v=>!v);setLayerPanelOpen(false)}}>Browse 26 water disclosures <span>→</span></button><label className="watershed-selector" htmlFor="atlas-watershed-level">Watershed boundaries<select id="atlas-watershed-level" aria-label="Watershed boundaries" value={watershedLevel} onChange={e=>setWatershedLevel(Number(e.target.value))}><option value={0}>Hidden</option><option value={2}>Region · HUC 2</option><option value={4}>Subregion · HUC 4</option><option value={8}>Subbasin · HUC 8</option><option value={12}>Subwatershed · HUC 12</option></select></label><div className="size-key" aria-hidden="true"><i/><i/><i/><span>Lower → higher consumption</span></div><p className="rail-note">Circle size indicates annual-average daily consumption. Boundaries show campus drainage, not supply catchments.</p></>}
        </div>
      {/* Layer panel — always mounted, slides in/out */}
      <LayerPanel
        open={true} onClose={()=>setLayerPanelOpen(false)}
        showDataCenters={showDataCenters} onToggleDC={() => setShowDataCenters(v => !v)}
        showPlants={showPlants}           onTogglePlants={() => setShowPlants(v => !v)}
        showPlanned={showPlanned}         onTogglePlanned={() => setShowPlanned(v => !v)}
        activeFuels={activeFuels}         onToggleFuel={toggleFuel}
        topOffset={86 + (stats && statsExpanded ? 30 : 0)}
      />

        <div className="rail-evidence"><span>RESEARCH COVERAGE</span><strong>{loaded?total.toLocaleString():'—'} locations <b> / </b> 26 disclosures</strong><p>Inventory dates vary · water reporting year 2025.<br/>Unreported use remains unknown.</p><a href="/evidence">Sources, dates &amp; methodology ↗</a></div>
      </aside>
      {registerOpen&&<FacilityDirectory facilities={allDcData.current} loaded={loaded} onClose={()=>setRegisterOpen(false)} onSelect={record=>{const dc=allDcData.current.find(d=>d.id===record.id);if(dc){setSelected(dc);setRegisterOpen(false);setFacilityTab('overview');map.current?.flyTo({center:[dc.lon,dc.lat],zoom:11,padding:window.innerWidth>800?{top:90,bottom:90,left:40,right:370}:{top:110,bottom:360,left:20,right:20}});}}}/>}
      {gridOpen&&<GridExplorer layer={gridLayer} onLayer={setGridLayer} onClose={()=>setGridOpen(false)} facilities={allDcData.current} onLocate={feature=>{const b=geometryBounds(feature.geometry);if(b)map.current?.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:window.innerWidth>800?{top:90,bottom:90,left:50,right:370}:60,maxZoom:10});}}/>}
      {gridStatus&&<p className="grid-map-status" role="status">{gridStatus}</p>}
      {waterOpen && <WaterExplorer watershedLevel={watershedLevel} onWatershedLevel={setWatershedLevel} canLocate={loaded} onClose={()=>setWaterOpen(false)} onSelect={(record: WaterRecord)=>{const dc=allDcData.current.find(d=>record.facilityIds.includes(d.id)); if(dc){setSelected(dc);setFacilityTab('water');setWaterOpen(false);map.current?.flyTo({center:[dc.lon,dc.lat],zoom:12,padding:window.innerWidth>800?{top:90,bottom:90,left:40,right:370}:{top:110,bottom:360,left:20,right:20}});}}}/>}
      {/* ── Context bar ── */}
      {context && (
        <div className="context-bar" style={{
          position: 'absolute', top: 56, left: 0, right: 0, height: 30,
          background: C.surface, borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center',
          padding: '0 24px', gap: 18, zIndex: 15,
        }}>
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.text, letterSpacing: '0.02em' }}>{context.region}</span>
          <div style={{ width: 1, height: 12, background: C.border2 }} />
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.text3 }}>
            <span style={{ color: C.green, fontWeight: 700 }}>{context.count}</span> inventory locations in bounds
          </span>
          {!showDataCenters && (
            <>
              <div style={{ width: 1, height: 12, background: C.border2 }} />
              <span style={{ fontFamily: MONO, fontSize: 9, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Data centers hidden
              </span>
            </>
          )}
          <button
            onClick={() => setStatsExpanded(v => !v)}
            title={statsExpanded ? 'Collapse stats' : 'Expand stats'}
            style={{
              marginLeft: 'auto', background: 'transparent', border: 'none',
              padding: '4px 6px', cursor: 'pointer',
              color: C.text3, display: 'flex', alignItems: 'center',
              transition: 'color 0.15s', flexShrink: 0,
            }}
          >
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none"
              style={{ transform: statsExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.22s cubic-bezier(0.22,1,0.36,1)' }}>
              <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      )}

      {stats && !waterMode && <StatsStrip stats={stats} expanded={statsExpanded} />}

      {!loaded&&!loadError&&MAPBOX_TOKEN&&<p className="map-loading" role="status">Loading map &amp; reviewed inventory… Water disclosures and sources remain available.</p>}
      {loadError && <p role="alert" className="load-error">The map or inventory could not load. Counts and map coverage are unavailable. Water disclosures and the evidence register remain accessible.</p>}
      {!MAPBOX_TOKEN && <p style={{position:'absolute',top:130,left:24,color:C.text2,maxWidth:360,fontSize:14,lineHeight:1.6}}>Map tiles need the existing public Mapbox token in this local checkout. Water source disclosures are available through the Water button.</p>}
      <div className="map-canvas" ref={mapContainer} style={{ width: '100%', height: '100%' }} />

      {compareOpen&&<FacilityComparison facilities={comparison} onClose={()=>setCompareOpen(false)} onRemove={id=>setComparison(rows=>rows.filter(dc=>dc.id!==id))}/> }
      {selected && !compareOpen && (
        <FacilityPanel key={selected.id} tab={facilityTab} onTab={setFacilityTab}
          dc={selected}
          comparisonState={comparison.some(dc=>dc.id===selected.id)?"added":comparison.length>=3?"full":"available"}
          onCompare={()=>{setComparison(rows=>rows.some(dc=>dc.id===selected.id)?rows:rows.length<3?[...rows,selected]:rows);setCompareOpen(true);setGridOpen(false);setWaterOpen(false);}}
          onClose={() => setSelected(null)}
          showElectrons={showElectrons}
          onToggleElectrons={() => setShowElectrons(v => !v)}
        />
      )}

      {tourStopIndex !== null && (
        <TourCallout
          stop={TOUR_STOPS[tourStopIndex]} stopIndex={tourStopIndex}
          total={TOUR_STOPS.length} onSkip={endTour} onNext={nextStop}
        />
      )}

      {/* About / methodology panel */}
      <AboutPanel open={aboutOpen} onClose={() => setAboutOpen(false)} />
      {aboutOpen && (
        <div
          onClick={() => setAboutOpen(false)}
          style={{ position: 'absolute', inset: 0, zIndex: 13 }}
        />
      )}



      {/* Search overlay */}
      {searchOpen && (
        <SearchOverlay
          dcs={allDcData.current}
          plants={allPlantsData.current}
          onSelectDc={dc => {
            setSelected(dc);setRegisterOpen(false);setCompareOpen(false);setWaterOpen(false);setFacilityTab('overview');
            setSearchOpen(false);
            setLayerPanelOpen(false);
            map.current?.flyTo({ center: [dc.lon, dc.lat], zoom: 13, padding:window.innerWidth>800?{top:90,bottom:90,left:40,right:370}:{top:110,bottom:360,left:20,right:20}, duration: 1000 });
          }}
          onSelectPlant={p => {
            setSearchOpen(false);
            map.current?.flyTo({ center: [p.lon, p.lat], zoom: 11, padding:0, duration: 1000 });
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {/* Splash screen */}
      {splashVisible && <SplashScreen fading={splashFading} onDismiss={dismissSplash} />}
    </div>
  );
}
