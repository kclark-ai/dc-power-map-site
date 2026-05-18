import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = import.meta.env.PUBLIC_MAPBOX_TOKEN;

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:       '#040e1f',
  surface:  '#071524',
  surface2: '#0c1d30',
  surface3: '#12263d',
  border:   '#1c3352',
  border2:  '#2a4b70',
  text:     '#dae7f5',
  text2:    '#6990b3',
  text3:    '#3a5570',
  green:    '#00e87a',
  orange:   '#ff7235',
  red:      '#ff2d55',
} as const;

const MONO = "'IBM Plex Mono', 'Courier New', monospace";
const SANS = "'Inter', system-ui, -apple-system, sans-serif";

const FUEL: Record<string, string> = {
  coal:        '#f43f5e',
  natural_gas: '#fb923c',
  nuclear:     '#a78bfa',
  solar:       '#fbbf24',
  wind:        '#34d399',
  hydro:       '#38bdf8',
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
  {
    id: 'nova', label: 'Northern Virginia',
    center: [-77.48, 38.92], zoom: 9.5,
    title: 'Data Center Alley',
    headline: '35% of all global internet traffic transits this 30-mile corridor in Loudoun County',
    facts: [
      '304 data centers concentrated around Ashburn — the densest cluster on Earth',
      'Dominion Energy grid: ~40% natural gas, forcing new gas peaker plant construction to keep up',
      'Power demand here rivals mid-sized US cities; substations are running out of capacity',
    ],
    color: C.orange,
  },
  {
    id: 'texas', label: 'Texas — DFW + Austin',
    center: [-97.2, 32.5], zoom: 7.5,
    title: 'The Isolated Grid',
    headline: 'ERCOT is an island — when demand spikes, Texas cannot borrow power from neighboring states',
    facts: [
      'Data center capacity growing 40%+ year-over-year — the fastest market in the US',
      'Grid runs ~50% natural gas; hyperscalers absorb spare capacity from west Texas wind farms',
      'February 2021 grid failure exposed the price of isolation: 246 people died, $200B in damage',
    ],
    color: '#fbbf24',
  },
  {
    id: 'phoenix', label: 'Phoenix, Arizona',
    center: [-111.97, 33.44], zoom: 9.5,
    title: 'Desert Computing',
    headline: 'Each large data center consumes 3–5 million gallons of water per day for evaporative cooling',
    facts: [
      "The Colorado River — Phoenix's primary water source — is at historic lows after decades of drought",
      'Arizona grid: ~40% natural gas + ~30% nuclear from Palo Verde, the largest plant in the US',
      'Mesa and Chandler are the fastest-growing data center submarkets in the country',
    ],
    color: C.red,
  },
  {
    id: 'pnw', label: 'Pacific Northwest',
    center: [-120.3, 47.5], zoom: 7.5,
    title: 'The Green Grid',
    headline: "BPA's hydroelectric grid makes this the cleanest compute region in the continental US",
    facts: [
      'Bonneville Power Administration: ~70% hydroelectric, ~15% wind, under 5% fossil fuels',
      'Google (The Dalles, OR), Microsoft (Quincy, WA), and Amazon run their largest campuses here',
      'Columbia River dams provide cheap, reliable, carbon-free baseload — the ideal data center power',
    ],
    color: C.green,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMixColor(mix: PowerMix): string {
  if (!mix) return C.text3;
  const clean = (mix.nuclear || 0) + (mix.solar || 0) + (mix.wind || 0) + (mix.hydro || 0);
  const gas   = mix.natural_gas || 0;
  const coal  = mix.coal || 0;
  if (clean < 0.05 && gas < 0.05 && coal < 0.05) return C.text3;
  if (clean > gas && clean > coal) return C.green;
  if (gas > coal) return C.orange;
  return C.red;
}

const AMBER = '#f59e0b';
const LAVENDER = '#818cf8';

// NERC 2024 Long-Term Reliability Assessment risk levels
const NERC_STRESS: Record<string, { level: string; color: string; badge: string; note: string }> = {
  RFC:  { level: 'High Risk',     color: '#ef4444', badge: '▲ HIGH RISK',  note: 'PJM footprint: generator retirements outpacing new capacity; NERC projects potential shortfalls 2026–2030' },
  MRO:  { level: 'High Risk',     color: '#ef4444', badge: '▲ HIGH RISK',  note: 'Upper Midwest: rapid coal retirements with insufficient wind/solar replacement confirmed in NERC 2024 LTRA' },
  TRE:  { level: 'Elevated Risk', color: '#f97316', badge: '◆ ELEVATED',   note: 'ERCOT: grid isolation blocks emergency imports; 2021 failure caused 246 deaths and $200B in damage' },
  SERC: { level: 'Elevated Risk', color: '#f97316', badge: '◆ ELEVATED',   note: 'Southeast: AI data center and EV load surging in Carolinas, Georgia, and Virginia — exceeding utility capacity plans' },
  WECC: { level: 'Moderate Risk', color: '#eab308', badge: '● MODERATE',   note: 'West: drought reduces hydro output; CAISO faces summer peak gaps; heat dome vulnerability in Pacific Northwest' },
  NPCC: { level: 'Moderate Risk', color: '#eab308', badge: '● MODERATE',   note: 'Northeast: ISO-NE winter gas constraints; aging transmission with limited new build in New England' },
  SPP:  { level: 'Low Risk',      color: '#4ade80', badge: '○ LOW RISK',   note: 'Great Plains: wind-rich grid with strong reserve margins; well-interconnected with MISO and WECC' },
  FRCC: { level: 'Moderate Risk', color: '#eab308', badge: '● MODERATE',   note: 'Florida (SERC subregion): high cooling load density and hurricane exposure; managed under SERC since 2022' },
};
const NERC_DEFAULT = { level: 'Unknown', color: '#4a6280', badge: '? UNKNOWN', note: 'Stress assessment not available for this NERC region' };

// ── Inline NERC GeoJSON ───────────────────────────────────────────────────────
function mkNercFeature(key: string, coords: [number, number][]): GeoJSON.Feature {
  const s = NERC_STRESS[key] || NERC_DEFAULT;
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coords] },
    properties: { _key: key, _color: s.color, _badge: s.badge, _label: key, _note: s.note, _level: s.level },
  };
}

const NERC_GEO: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    // WECC — Western Electricity Coordinating Council
    mkNercFeature('WECC', [
      [-124.5, 49.0], [-104.1, 49.0], [-104.1, 41.0], [-111.5, 37.0],
      [-114.0, 32.5], [-117.1, 32.5], [-120.5, 33.9], [-124.5, 40.5], [-124.5, 49.0],
    ]),
    // TRE — Texas RE (ERCOT)
    mkNercFeature('TRE', [
      [-106.6, 36.5], [-100.0, 36.5], [-94.0, 36.5],
      [-93.5, 29.8], [-97.0, 25.8], [-100.5, 25.8], [-106.6, 31.5], [-106.6, 36.5],
    ]),
    // SPP — Southwest Power Pool (Great Plains)
    mkNercFeature('SPP', [
      [-104.1, 49.0], [-88.5, 49.0], [-88.5, 35.5],
      [-88.5, 29.0], [-94.0, 29.0], [-94.0, 36.5], [-100.0, 36.5],
      [-104.1, 36.5], [-104.1, 41.0], [-104.1, 49.0],
    ]),
    // MRO — Midwest Reliability Organization (Upper Midwest)
    mkNercFeature('MRO', [
      [-104.1, 49.0], [-82.5, 49.0], [-82.5, 45.5],
      [-88.5, 44.5], [-88.5, 49.0], [-104.1, 49.0],
    ]),
    // RFC — ReliabilityFirst (PJM / Great Lakes / Mid-Atlantic)
    mkNercFeature('RFC', [
      [-88.5, 44.5], [-74.0, 44.5], [-74.0, 38.5],
      [-77.0, 36.5], [-84.0, 35.0], [-88.5, 35.5], [-88.5, 44.5],
    ]),
    // SERC — SERC Reliability Corporation (Southeast)
    mkNercFeature('SERC', [
      [-94.0, 36.5], [-77.0, 36.5], [-75.0, 34.5],
      [-79.9, 31.0], [-87.6, 31.0], [-88.5, 29.0],
      [-94.0, 29.0], [-94.0, 36.5],
    ]),
    // NPCC — Northeast Power Coordinating Council
    mkNercFeature('NPCC', [
      [-74.0, 44.5], [-66.9, 47.5], [-66.9, 40.4],
      [-74.0, 38.5], [-74.0, 44.5],
    ]),
    // FRCC — Florida Reliability Coordinating Council
    mkNercFeature('FRCC', [
      [-87.6, 31.0], [-79.9, 31.0], [-80.0, 24.4],
      [-82.0, 24.4], [-87.6, 26.0], [-87.6, 31.0],
    ]),
  ],
};

// ── Inline Water Stress counties ─────────────────────────────────────────────
// [west_lon, south_lat, east_lon, north_lat, stress_score (1=Low … 5=Extremely High)]
// Focus on 10 DC-dense states + key stressed markets
const WATER_COUNTIES: [number, number, number, number, number][] = [
  // Arizona — extremely high stress
  [-113.5, 33.0, -111.0, 33.9, 5], // Maricopa (Phoenix)
  [-112.0, 32.4, -110.4, 33.5, 5], // Pinal
  [-112.2, 31.3, -110.5, 32.5, 4], // Pima (Tucson)
  [-114.8, 32.5, -114.0, 33.0, 5], // Yuma
  // Nevada
  [-115.9, 35.0, -114.1, 36.9, 5], // Clark (Las Vegas)
  [-120.0, 39.3, -118.4, 42.0, 4], // Washoe (Reno)
  [-120.0, 38.8, -119.3, 39.3, 4], // Douglas
  // California — high/very high stress
  [-118.9, 33.7, -117.6, 34.8, 5], // Los Angeles
  [-117.6, 32.5, -116.1, 33.5, 5], // San Diego
  [-118.1, 33.4, -117.4, 33.9, 4], // Orange
  [-117.7, 33.4, -114.5, 34.0, 5], // Riverside
  [-117.6, 34.0, -114.1, 35.8, 4], // San Bernardino
  [-120.1, 34.9, -118.0, 35.8, 5], // Kern
  [-119.3, 34.0, -118.5, 34.5, 4], // Ventura
  [-122.2, 37.1, -121.2, 37.5, 4], // Santa Clara (Silicon Valley)
  [-122.4, 37.4, -121.4, 37.9, 4], // Alameda
  [-122.4, 37.8, -121.5, 38.1, 3], // Contra Costa
  [-121.9, 38.2, -121.0, 38.7, 3], // Sacramento
  // Colorado — high stress (Front Range)
  [-105.1, 39.6, -104.7, 39.9, 4], // Denver
  [-105.5, 39.5, -105.0, 39.9, 4], // Jefferson
  [-104.9, 39.6, -104.6, 39.9, 4], // Arapahoe
  [-105.2, 39.3, -104.6, 39.6, 4], // Douglas (CO)
  [-105.1, 39.8, -104.5, 40.2, 4], // Adams
  // New Mexico
  [-106.9, 34.9, -106.4, 35.2, 5], // Bernalillo (Albuquerque)
  // Utah
  [-112.2, 40.5, -111.7, 40.9, 4], // Salt Lake
  [-111.9, 40.1, -111.5, 40.5, 4], // Utah County
  // Texas
  [-106.5, 31.6, -105.9, 32.1, 5], // El Paso
  [-100.1, 27.5, -99.4, 28.2,  5], // Webb (Laredo)
  [-98.7,  26.1, -98.0, 26.5,  5], // Hidalgo (McAllen)
  [-98.9,  29.2, -98.2, 29.8,  4], // Bexar (San Antonio)
  [-98.2,  30.1, -97.4, 30.6,  4], // Travis (Austin)
  [-97.9,  30.5, -97.2, 30.9,  3], // Williamson
  [-97.5,  32.5, -97.0, 33.0,  3], // Tarrant (Fort Worth)
  [-97.0,  32.6, -96.5, 33.0,  3], // Dallas
  [-97.4,  33.0, -96.9, 33.4,  3], // Denton
  [-96.8,  33.1, -96.4, 33.6,  3], // Collin
  [-95.9,  29.5, -95.0, 30.1,  3], // Harris (Houston)
  [-96.0,  29.4, -95.4, 29.9,  3], // Fort Bend
  // Virginia — Northern Virginia (moderate stress)
  [-77.9,  38.9, -77.3, 39.3,  2], // Loudoun
  [-77.7,  38.6, -77.2, 38.9,  2], // Prince William
  [-77.5,  38.6, -77.1, 38.9,  2], // Fairfax
  [-77.2,  38.8, -77.0, 38.9,  2], // Arlington
  // Georgia
  [-84.7,  33.6, -84.3, 34.1,  2], // Fulton (Atlanta)
  [-84.9,  33.6, -84.6, 34.0,  2], // Douglas (GA)
  [-84.0,  33.5, -83.6, 33.9,  2], // Newton
  // North Carolina
  [-78.9,  35.6, -78.5, 36.0,  2], // Wake (Raleigh)
  [-80.9,  35.0, -80.5, 35.5,  2], // Mecklenburg (Charlotte)
  // South Carolina
  [-81.3,  33.9, -80.8, 34.2,  2], // Richland (Columbia)
  // New Jersey
  [-74.3,  40.8, -73.9, 41.1,  2], // Bergen
  [-74.3,  40.7, -74.1, 40.9,  2], // Essex
  // New York
  [-74.1,  41.0, -73.5, 41.4,  2], // Westchester
  [-73.8,  40.6, -73.4, 40.9,  2], // Nassau
  // Illinois
  [-88.3,  41.6, -87.5, 42.2,  1], // Cook (Chicago)
  [-88.3,  41.6, -87.9, 42.1,  1], // DuPage
  // Ohio
  [-83.2,  39.9, -82.8, 40.2,  1], // Franklin (Columbus)
  [-81.9,  41.3, -81.4, 41.6,  1], // Cuyahoga (Cleveland)
  // Indiana
  [-86.4,  39.6, -85.9, 40.0,  2], // Marion (Indianapolis)
  // Michigan
  [-83.3,  42.1, -82.9, 42.5,  1], // Wayne (Detroit)
  [-84.0,  42.1, -83.5, 42.5,  1], // Washtenaw (Ann Arbor)
  // Oregon
  [-122.9, 45.4, -122.3, 45.7, 2], // Multnomah (Portland)
  [-118.9, 45.6, -118.3, 46.0, 3], // Umatilla (data center corridor)
  // Washington
  [-122.5, 47.1, -121.8, 47.8, 2], // King (Seattle)
  [-119.7, 47.0, -119.0, 47.4, 3], // Grant (Quincy DC hub)
  // Florida
  [-80.6,  25.2, -80.1, 25.9,  2], // Miami-Dade
  [-80.6,  25.9, -80.1, 26.4,  2], // Broward
  [-80.5,  26.4, -80.0, 26.9,  2], // Palm Beach
];

const CO2_KG_PER_MWH: Record<string, number> = {
  coal: 1001, natural_gas: 469, nuclear: 12, solar: 46, wind: 11, hydro: 24, other: 500,
};
const CAPACITY_FACTOR: Record<string, number> = {
  coal: 0.50, natural_gas: 0.40, nuclear: 0.90, solar: 0.22, wind: 0.35, hydro: 0.38, other: 0.40,
};

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

const FUEL_ORDER = [
  { key: 'nuclear',     label: 'Nuclear'     },
  { key: 'solar',       label: 'Solar'       },
  { key: 'wind',        label: 'Wind'        },
  { key: 'hydro',       label: 'Hydro'       },
  { key: 'natural_gas', label: 'Natural Gas' },
  { key: 'coal',        label: 'Coal'        },
  { key: 'other',       label: 'Other'       },
];

// ── Shared primitives ─────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: MONO, fontSize: 9, fontWeight: 600,
      letterSpacing: '0.14em', textTransform: 'uppercase', color: C.text3,
      marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: C.border }} />;
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: '0.1em',
      padding: '3px 8px', borderRadius: 3, textTransform: 'uppercase',
      background: `${color}18`, color, border: `1px solid ${color}35`,
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      {children}
    </span>
  );
}

function Toggle({
  on, onChange, label, sublabel, disabled,
}: {
  on: boolean; onChange: () => void; label: string; sublabel?: string; disabled?: boolean;
}) {
  return (
    <div
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
    <div
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
function FuelBar({ mix }: { mix: PowerMix }) {
  const segments = FUEL_ORDER.map(f => ({ ...f, v: (mix as any)[f.key] || 0 })).filter(f => f.v > 0.01);
  return (
    <div>
      <div style={{ display: 'flex', height: 3, borderRadius: 2, overflow: 'hidden', background: C.surface3, marginBottom: 14, gap: 1 }}>
        {segments.map(f => (
          <div key={f.key} style={{ flex: f.v, background: FUEL[f.key], borderRadius: 1 }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {segments.map(f => (
          <div key={f.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: 1, background: FUEL[f.key], flexShrink: 0 }} />
              <span style={{ fontFamily: MONO, fontSize: 11, color: C.text2 }}>{f.label}</span>
            </div>
            <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: FUEL[f.key] }}>
              {(f.v * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── DetailPanel ───────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  if (status === 'under_construction') return <Badge color={AMBER}>◑ Under Construction</Badge>;
  if (status === 'planned') return <Badge color={LAVENDER}>○ Planned</Badge>;
  return <Badge color={C.green}>● {status || 'operational'}</Badge>;
}

function DetailPanel({ dc, onClose, showElectrons, onToggleElectrons }: {
  dc: DataCenter; onClose: () => void;
  showElectrons: boolean; onToggleElectrons: () => void;
}) {
  const hasMix  = dc.power_mix && Object.values(dc.power_mix).some(v => typeof v === 'number' && (v as number) > 0.01);
  const hasPPAs = dc.direct_ppas?.length > 0;
  const accent  = dc.status === 'under_construction' ? AMBER
                : dc.status === 'planned'            ? LAVENDER
                : getMixColor(dc.power_mix);
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      const inp = document.createElement('input');
      inp.value = window.location.href;
      document.body.appendChild(inp);
      inp.select();
      document.execCommand('copy');
      document.body.removeChild(inp);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <div style={{
      position: 'absolute', top: 96, right: 20, width: 316,
      background: C.surface, border: `1px solid ${C.border}`,
      borderTop: `2px solid ${accent}`, borderRadius: 8,
      color: C.text, fontFamily: SANS,
      boxShadow: `0 0 0 1px ${C.border}, 0 32px 64px rgba(0,0,0,0.7), 0 0 80px ${accent}12`,
      animation: 'panelIn 0.16s ease',
      overflow: 'hidden', zIndex: 10,
    }}>
      <style>{`@keyframes panelIn { from { opacity:0; transform:translateX(10px); } to { opacity:1; transform:translateX(0); } }`}</style>
      <div style={{ padding: '18px 20px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.35, color: C.text, letterSpacing: '-0.015em', marginBottom: 4 }}>
              {dc.name || dc.operator || 'Unnamed Facility'}
            </div>
            {dc.operator && dc.name && dc.operator !== dc.name && (
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.text3, marginBottom: 2 }}>{dc.operator}</div>
            )}
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.text3 }}>{dc.state}</div>
          </div>
          <button onClick={onClose} style={{
            flexShrink: 0, width: 28, height: 28, background: C.surface3,
            border: `1px solid ${C.border}`, color: C.text2, cursor: 'pointer',
            borderRadius: 5, fontSize: 18, lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SANS,
          }}>×</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <StatusBadge status={dc.status || 'operational'} />
          {hasPPAs && <Badge color={FUEL.nuclear}>⚡ Direct PPA</Badge>}
          {dc.capacity_mw && <Badge color={C.text2}>{dc.capacity_mw} MW</Badge>}
        </div>
      </div>
      <Divider />
      <div style={{ padding: '16px 20px' }}>
        <SectionLabel>Power Mix</SectionLabel>
        {hasMix
          ? <FuelBar mix={dc.power_mix} />
          : <div style={{ fontFamily: MONO, fontSize: 11, color: C.text3 }}>Mix data pending EIA territory join</div>
        }
      </div>
      {hasPPAs && (
        <>
          <Divider />
          <div style={{ padding: '16px 20px' }}>
            <SectionLabel>Direct PPAs</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {dc.direct_ppas.map((ppa: any, i: number) => (
                <div key={i} style={{ padding: '10px 12px', background: C.surface2, borderRadius: 5, borderLeft: `2px solid ${FUEL.nuclear}` }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 4 }}>{ppa.source_name}</div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: C.text3 }}>
                    {[ppa.type?.toUpperCase(), ppa.mw && `${ppa.mw} MW`, ppa.year_signed].filter(Boolean).join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {dc.utility?.name && (
        <>
          <Divider />
          <div style={{ padding: '14px 20px' }}>
            <SectionLabel>Utility Provider</SectionLabel>
            <div style={{ fontSize: 12, color: C.text2 }}>{dc.utility.name}</div>
          </div>
        </>
      )}
      {dc.notes && (
        <>
          <Divider />
          <div style={{ padding: '14px 20px 18px' }}>
            <SectionLabel>Why it matters</SectionLabel>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.text2, lineHeight: 1.65 }}>
              {dc.notes}
            </div>
          </div>
        </>
      )}
      <Divider />
      {/* Follow the electrons toggle */}
      <div style={{ padding: '10px 20px 8px' }}>
        <div
          onClick={onToggleElectrons}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            padding: '8px 12px', borderRadius: 6,
            background: showElectrons ? `${accent}08` : C.surface2,
            border: `1px solid ${showElectrons ? accent + '30' : C.border}`,
            cursor: 'pointer', transition: 'background 0.18s, border-color 0.18s',
            userSelect: 'none',
          }}
        >
          <div>
            <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, color: showElectrons ? C.text : C.text2, transition: 'color 0.15s' }}>
              Follow the electrons
            </div>
            <div style={{ fontFamily: MONO, fontSize: 9, color: C.text3, marginTop: 2, letterSpacing: '0.04em' }}>
              Show lines to 3 nearest power plants
            </div>
          </div>
          <div style={{
            flexShrink: 0, width: 34, height: 18, borderRadius: 9,
            background: showElectrons ? accent : C.surface3,
            border: `1px solid ${showElectrons ? accent + '80' : C.border2}`,
            position: 'relative', transition: 'background 0.18s, border-color 0.18s',
          }}>
            <div style={{
              position: 'absolute', top: 2, left: showElectrons ? 16 : 2,
              width: 12, height: 12, borderRadius: '50%',
              background: showElectrons ? C.bg : C.text3,
              transition: 'left 0.18s cubic-bezier(0.22,1,0.36,1), background 0.18s',
            }} />
          </div>
        </div>
      </div>
      <Divider />
      <div style={{ padding: '10px 20px 14px' }}>
        <button
          onClick={share}
          style={{
            width: '100%', padding: '8px 14px',
            fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
            textTransform: 'uppercase',
            background: copied ? `${C.green}15` : 'transparent',
            border: `1px solid ${copied ? C.green + '55' : C.border}`,
            color: copied ? C.green : C.text3,
            borderRadius: 5, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            transition: 'background 0.2s, border-color 0.2s, color 0.2s',
          }}
        >
          {copied ? (
            <><span>✓</span> Copied to clipboard</>
          ) : (
            <><span style={{ fontSize: 13 }}>↗</span> Share this facility</>
          )}
        </button>
      </div>
    </div>
  );
}

// ── TourCallout ───────────────────────────────────────────────────────────────
function TourCallout({ stop, stopIndex, total, onSkip, onNext }: {
  stop: TourStop; stopIndex: number; total: number; onSkip: () => void; onNext: () => void;
}) {
  const isLast = stopIndex + 1 >= total;
  return (
    <div style={{ position: 'absolute', bottom: 44, left: '50%', zIndex: 30, width: 520 }}>
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
  showPlanned, onTogglePlanned, showNerc, onToggleNerc, showWater, onToggleWater,
  activeFuels, onToggleFuel, ppasOnly, onTogglePpasOnly, topOffset }: {
  open: boolean;
  showDataCenters: boolean; onToggleDC: () => void;
  showPlants: boolean;      onTogglePlants: () => void;
  showPlanned: boolean;     onTogglePlanned: () => void;
  showNerc: boolean;        onToggleNerc: () => void;
  showWater: boolean;       onToggleWater: () => void;
  activeFuels: Set<string>; onToggleFuel: (f: FuelKey) => void;
  ppasOnly: boolean;        onTogglePpasOnly: () => void;
  topOffset: number;
}) {
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
    <div style={{
      position: 'absolute', top: topOffset, right: 0,
      width: 272,
      height: `calc(100% - ${topOffset}px)`,
      background: C.surface,
      borderLeft: `1px solid ${C.border}`,
      zIndex: 12,
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
          Map Layers
        </div>
        <div style={{ fontFamily: MONO, fontSize: 9, color: C.text3 }}>
          {[showDataCenters && 'DC', showPlants && someFuelsOn && 'Plants'].filter(Boolean).join(' · ') || 'None visible'}
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
          label="Emerging Campuses"
          sublabel="Planned & under-construction facilities (2023–2026)"
          on={showPlanned}
          onChange={onTogglePlanned}
        />
        <Toggle
          label="NERC Grid Zones"
          sublabel="Reliability regions with 2024 LTRA stress assessment"
          on={showNerc}
          onChange={onToggleNerc}
        />
        <Toggle
          label="Water Stress"
          sublabel="WRI Aqueduct county-level baseline water stress"
          on={showWater}
          onChange={onToggleWater}
        />
      </div>

      {/* Section: Fuel type filter */}
      <div style={{
        padding: '14px 20px 12px',
        borderBottom: `1px solid ${C.border}`,
        flexShrink: 0,
        opacity: showPlants ? 1 : 0.45,
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

      {/* Section: Data center filters */}
      <div style={{ padding: '14px 20px 12px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.text3, marginBottom: 6 }}>
          Filters
        </div>
        <Toggle
          label="PPAs Only"
          sublabel="Show only facilities with direct power purchase agreements"
          on={ppasOnly}
          onChange={onTogglePpasOnly}
          disabled={!showDataCenters}
        />
      </div>

      {/* NERC stress legend (only when layer is on) */}
      {showNerc && (
        <div style={{ padding: '14px 20px 12px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.text3, marginBottom: 8 }}>
            Grid Stress · NERC 2024 LTRA
          </div>
          {([
            ['high',     '#ef4444', '▲ High Risk'],
            ['elevated', '#f97316', '◆ Elevated'],
            ['moderate', '#eab308', '● Moderate'],
            ['low',      '#4ade80', '○ Low Risk'],
          ] as [string, string, string][]).map(([, color, label]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: 1, background: color, flexShrink: 0, opacity: 0.85 }} />
              <span style={{ fontFamily: MONO, fontSize: 10, color: C.text2 }}>{label}</span>
            </div>
          ))}
          <div style={{ fontFamily: MONO, fontSize: 9, color: C.text3, marginTop: 8, lineHeight: 1.5 }}>
            Source: NERC Long-Term Reliability Assessment 2024
          </div>
        </div>
      )}

      {/* Water stress legend (only when layer is on) */}
      {showWater && (
        <div style={{ padding: '14px 20px 12px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.text3, marginBottom: 8 }}>
            Water Stress · WRI Aqueduct
          </div>
          {([
            ['#fde68a', 'Low'],
            ['#f97316', 'Medium-High'],
            ['#ef4444', 'High'],
            ['#dc2626', 'Very High'],
            ['#7f1d1d', 'Extremely High'],
          ] as [string, string][]).map(([color, label]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 5 }}>
              <div style={{ width: 14, height: 8, borderRadius: 1, background: color, flexShrink: 0, opacity: 0.85 }} />
              <span style={{ fontFamily: MONO, fontSize: 10, color: C.text2 }}>{label}</span>
            </div>
          ))}
          <div style={{ fontFamily: MONO, fontSize: 9, color: C.text3, marginTop: 8, lineHeight: 1.5 }}>
            Counties with high stress overlap
            dense DC clusters in Phoenix,
            Las Vegas &amp; west Texas.
          </div>
          <div style={{ fontFamily: MONO, fontSize: 8, color: C.text3, marginTop: 6, opacity: 0.6 }}>
            Source: WRI Aqueduct 3.0
          </div>
        </div>
      )}

      {/* Stats footer */}
      <div style={{ padding: '12px 20px', marginTop: 'auto', flexShrink: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 9, color: C.text3, lineHeight: 1.7 }}>
          <div><span style={{ color: C.text2 }}>407</span> facilities with direct PPAs</div>
          <div><span style={{ color: C.text2 }}>14,793</span> power plants indexed</div>
          <div style={{ marginTop: 4 }}>
            <span style={{ color: AMBER }}>14</span>{' '}
            <span style={{ color: C.text3 }}>under construction · </span>
            <span style={{ color: LAVENDER }}>6</span>{' '}
            <span style={{ color: C.text3 }}>planned</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────
function Legend({ showPlants, showPlanned }: { showPlants: boolean; showPlanned: boolean }) {
  return (
    <div style={{
      position: 'absolute', bottom: 40, left: 20,
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: '16px 18px', zIndex: 10, minWidth: 206, fontFamily: SANS,
    }}>
      <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.text3, marginBottom: 12 }}>
        Data Centers
      </div>
      {([
        [C.green,  'Clean (nuclear · solar · wind · hydro)'],
        [C.orange, 'Natural gas'],
        [C.red,    'Coal'],
        [C.text3,  'Unknown / mixed'],
      ] as [string, string][]).map(([color, label]) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, boxShadow: `0 0 6px ${color}` }} />
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.text2 }}>{label}</span>
        </div>
      ))}
      {showPlanned && (
        <>
          <div style={{ height: 1, background: C.border, margin: '10px 0 10px' }} />
          <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.text3, marginBottom: 10 }}>
            Emerging
          </div>
          {([
            [AMBER,   '○', 'Under construction'],
            [LAVENDER,'○', 'Planned (announced)'],
          ] as [string, string, string][]).map(([color, sym, label]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', border: `2px solid ${color}`, flexShrink: 0 }} />
              <span style={{ fontFamily: MONO, fontSize: 10, color: C.text2 }}>{label}</span>
            </div>
          ))}
        </>
      )}
      {showPlants && (
        <>
          <div style={{ height: 1, background: C.border, margin: '12px 0' }} />
          <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.text3, marginBottom: 12 }}>
            Power Plants
          </div>
          {([
            [FUEL.coal,        'Coal'],
            [FUEL.natural_gas, 'Natural gas'],
            [FUEL.nuclear,     'Nuclear'],
            [FUEL.solar,       'Solar'],
            [FUEL.wind,        'Wind'],
            [FUEL.hydro,       'Hydro'],
          ] as [string, string][]).map(([color, label]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0, boxShadow: `0 0 5px ${color}80` }} />
              <span style={{ fontFamily: MONO, fontSize: 10, color: C.text2 }}>{label}</span>
            </div>
          ))}
        </>
      )}
      <div style={{ height: 1, background: C.border, margin: '12px 0 10px' }} />
      <div style={{ fontFamily: MONO, fontSize: 9, color: C.text3, letterSpacing: '0.06em' }}>PNNL IM3 ATLAS v2026.02</div>
    </div>
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
  { num: '1,499',  desc: 'data centers mapped across the United States', accent: C.green  },
  { num: '324',    desc: 'in Northern Virginia alone — the densest cluster on Earth', accent: C.orange },
  { num: '+40%',   desc: 'AI data center power demand growth in 2024. The grid wasn\'t ready.', accent: C.red },
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
            Power Map
          </div>
        </div>

        {/* Subtitle */}
        <div style={{
          fontFamily: MONO, fontSize: 13, color: C.orange,
          letterSpacing: '-0.005em', lineHeight: 1.5, marginBottom: 36,
        }}>
          AI infrastructure is an energy policy problem
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
          Data: PNNL IM3 ATLAS v2026.02 · EIA Form 860/923 · 2023 release
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
    version: 'v2026.02',
    count: '1,499 facilities',
    desc: 'US data center locations with operator, state, utility territory, and estimated power mix. Published by the Pacific Northwest National Laboratory Integrated Multisector Multiscale Modeling initiative.',
    url: null,
    urlLabel: null,
  },
  {
    name: 'EIA Form 860',
    version: '2023 release',
    count: '14,793 power plants',
    desc: 'Annual generator inventory: capacity, fuel type, and ownership for all US utility-scale generating units. The authoritative federal source for power plant data.',
    url: 'https://www.eia.gov/electricity/data/eia860/',
    urlLabel: 'eia.gov · electricity/data/eia860',
  },
  {
    name: 'EIA Form 923',
    version: '2023 release',
    count: 'Generation & fuel data',
    desc: 'Monthly and annual generation, fuel receipts, and heat rates for US power plants. Used to cross-validate capacity-based power mix estimates.',
    url: 'https://www.eia.gov/electricity/data/eia923/',
    urlLabel: 'eia.gov · electricity/data/eia923',
  },
  {
    name: 'Hand-curated Emerging Campuses',
    version: '2023–2026',
    count: '20 facilities',
    desc: 'Major announced or under-construction AI data center campuses sourced from public press releases, local planning filings, corporate disclosures, and news reporting.',
    url: null,
    urlLabel: null,
  },
];

const ABOUT_LIMITATIONS = [
  'Power mix is capacity-based, not generation-based — nameplate MW fractions overstate intermittent sources (solar, wind) relative to their actual contribution to delivered electricity.',
  'Utility territory join uses a state-level average as fallback for ~23% of facilities where utility mapping is unavailable or ambiguous.',
  'Facility coordinates are sourced from OpenStreetMap and public records; positional accuracy varies — approximately 8% of facilities may have errors exceeding 500 m.',
  '"Follow the electrons" shows the 3 geographically nearest power plants as a visual heuristic only — not actual grid topology.',
  'Emerging campus data reflects public announcements as of early 2026. Projects may be delayed, scaled down, or cancelled.',
  'Power plant dataset excludes facilities under 1 MW nameplate capacity and those with undetermined fuel classification.',
] as const;

function AboutPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
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
          ['Power mix',    'Assigned per facility from power plants sharing the same utility territory. Where utility mapping is unavailable, a state-average capacity mix is used as fallback. Fractions are capacity-weighted, not generation-weighted.'],
          ['CO₂ estimates','Calculated as: capacity (MW) × fuel-specific capacity factor × 8,760 h × kg CO₂/MWh. Emission factors: coal 1,001 · gas 469 · nuclear 12 · solar 46 · wind 11 · hydro 24 kg/MWh.'],
          ['MW demand',    'Estimated at 50 MW average per data center. Actual values range from <1 MW (edge nodes) to >1,000 MW (hyperscale AI campuses). This is a planning-level approximation only.'],
          ['Nearest plants','"Follow the electrons" uses Euclidean distance in lat/lon space to find the 3 closest plants — a visual heuristic, not grid topology.'],
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
          ['Base dataset',     'Annual — aligned with EIA Form 860 release (~Q2)'],
          ['Power plants',     'Annual — EIA Form 860/923 update cycle'],
          ['Emerging DCs',     'Ad hoc — updated as major announcements are confirmed'],
          ['NERC assessments', 'Annual — Long-Term Reliability Assessment (November)'],
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
  const fmt = (n: number) => {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
    return n.toFixed(0);
  };
  const items: [string, string, string][] = [
    ['EST. DEMAND', `${fmt(stats.mwDemand)} MW`, C.orange],
    ['PLANT CO₂/YR', `${fmt(stats.co2Tons)} t`, C.red],
    ['POWER PLANTS', stats.plantCount.toLocaleString(), C.text2],
    ['WITH PPA', stats.withPPA.toString(), C.green],
    ['NO PPA', stats.withoutPPA.toString(), C.text3],
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
        visible · 50 MW avg/DC
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DataCenterMap() {
  const mapContainer     = useRef<HTMLDivElement>(null);
  const map              = useRef<mapboxgl.Map | null>(null);
  const tourActive       = useRef(false);
  const tourTimers       = useRef<ReturnType<typeof setTimeout>[]>([]);
  const dcAllFeatures    = useRef<GeoJSON.Feature[]>([]);
  const dcPpaFeatures    = useRef<GeoJSON.Feature[]>([]);
  const plannedFeatures  = useRef<GeoJSON.Feature[]>([]);
  const allDcData        = useRef<DataCenter[]>([]);
  const allPlantsData    = useRef<any[]>([]);
  const electronAnimRef  = useRef<number | null>(null);

  const [selected,      setSelected]      = useState<DataCenter | null>(null);
  const [total,         setTotal]         = useState(0);
  const [loaded,        setLoaded]        = useState(false);
  const [context,       setContext]       = useState<{ count: number; region: string } | null>(null);
  const [tourRunning,   setTourRunning]   = useState(false);
  const [tourStopIndex, setTourStopIndex] = useState<number | null>(null);
  // Layer panel state
  const [layerPanelOpen,  setLayerPanelOpen]  = useState(false);
  const [aboutOpen,       setAboutOpen]       = useState(false);
  const [showDataCenters, setShowDataCenters] = useState(true);
  const [showPlants,      setShowPlants]      = useState(true);
  const [activeFuels,     setActiveFuels]     = useState<Set<FuelKey>>(new Set(ALL_FUELS));
  const [ppasOnly,        setPpasOnly]        = useState(false);
  const [showPlanned,     setShowPlanned]     = useState(true);
  const [showNerc,        setShowNerc]        = useState(true);
  const [showWater,       setShowWater]       = useState(false);
  const [searchOpen,      setSearchOpen]      = useState(false);
  const [showElectrons,   setShowElectrons]   = useState(true);
  // Stats strip
  const [stats,           setStats]           = useState<MapStats | null>(null);
  const [statsExpanded,   setStatsExpanded]   = useState(true);
  // Splash state
  const [splashVisible,   setSplashVisible]   = useState(() => {
    try { return localStorage.getItem('dc-map-splash-dismissed') !== '1'; } catch { return true; }
  });
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
    const src = map.current.getSource('datacenters') as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: ppasOnly ? dcPpaFeatures.current : dcAllFeatures.current,
    });
  }, [loaded, ppasOnly]);

  useEffect(() => {
    if (!loaded || !map.current) return;
    const vis = showPlanned ? 'visible' : 'none';
    ['emerging-uc-glow', 'emerging-uc', 'emerging-planned-glow', 'emerging-planned'].forEach(l => {
      if (map.current?.getLayer(l)) map.current!.setLayoutProperty(l, 'visibility', vis);
    });
  }, [loaded, showPlanned]);

  useEffect(() => {
    if (!loaded || !map.current) return;
    const vis = showNerc ? 'visible' : 'none';
    ['nerc-fill', 'nerc-border', 'nerc-label'].forEach(l => {
      if (map.current?.getLayer(l)) map.current!.setLayoutProperty(l, 'visibility', vis);
    });
  }, [loaded, showNerc]);

  useEffect(() => {
    if (!loaded || !map.current) return;
    const vis = showWater ? 'visible' : 'none';
    ['water-fill', 'water-border'].forEach(l => {
      if (map.current?.getLayer(l)) map.current!.setLayoutProperty(l, 'visibility', vis);
    });
  }, [loaded, showWater]);

  // ── URL deep-link sync ─────────────────────────────────────────────────────
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected) {
      url.searchParams.set('facility', selected.id);
    } else {
      url.searchParams.delete('facility');
    }
    window.history.replaceState(null, '', url.searchParams.toString()
      ? `${url.pathname}?${url.searchParams}`
      : url.pathname);
  }, [selected]);

  // ── Electron lines ─────────────────────────────────────────────────────────
  const clearElectronLines = () => {
    if (electronAnimRef.current !== null) {
      cancelAnimationFrame(electronAnimRef.current);
      electronAnimRef.current = null;
    }
    if (!map.current) return;
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    (map.current.getSource('electron-lines')  as mapboxgl.GeoJSONSource | undefined)?.setData(empty);
    (map.current.getSource('electron-labels') as mapboxgl.GeoJSONSource | undefined)?.setData(empty);
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
      (map.current.getSource('electron-lines') as mapboxgl.GeoJSONSource).setData({
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
        (map.current.getSource('electron-labels') as mapboxgl.GeoJSONSource).setData({
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

  const flyToStop = (index: number) => {
    if (!tourActive.current || !map.current) return;
    setTourStopIndex(null);
    map.current.flyTo({ center: TOUR_STOPS[index].center, zoom: TOUR_STOPS[index].zoom, duration: 2800, essential: true });
    const t1 = setTimeout(() => { if (!tourActive.current) return; setTourStopIndex(index); }, 3000);
    const t2 = setTimeout(() => {
      if (!tourActive.current) return;
      const next = index + 1;
      if (next < TOUR_STOPS.length) flyToStop(next); else endTour();
    }, 7000);
    tourTimers.current.push(t1, t2);
  };

  const startTour = () => {
    if (!map.current || !loaded) return;
    clearTourTimers();
    tourActive.current = true;
    setTourRunning(true);
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

  const reopenSplash = () => {
    setSplashFading(false);
    setSplashVisible(true);
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
    mapboxgl.accessToken = MAPBOX_TOKEN;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-96, 38], zoom: 4,
      projection: 'mercator' as any,
    });

    map.current.on('load', async () => { try {
      const [dcRes, plantsRes] = await Promise.all([
        fetch('/datacenters.json'),
        fetch('/powerplants.json'),
      ]);
      const json       = await dcRes.json();
      const plantsJson = await plantsRes.json();
      const data: DataCenter[] = json.data;
      allDcData.current     = data;
      allPlantsData.current = plantsJson.plants;
      setTotal(data.length);
      setLoaded(true);

      // Context bar
      const updateContext = () => {
        const features = map.current!.queryRenderedFeatures({ layers: ['unclustered'] });
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

        // Stats strip computation
        const clusterFeats  = map.current!.queryRenderedFeatures({ layers: ['clusters'] });
        const emergingFeats = map.current!.queryRenderedFeatures({ layers: ['emerging-uc', 'emerging-planned'] });
        const clusterTotal  = clusterFeats.reduce((s: number, f: any) => s + (f.properties?.point_count || 0), 0);
        const totalDCs      = features.length + clusterTotal + emergingFeats.length;
        const withPPA       = features.filter((f: any) => f.properties?._has_ppas === 1).length;

        const plantFeats = map.current!.queryRenderedFeatures({ layers: ['plants'] });
        const seen       = new Set<string>();
        let co2Tons = 0; let plantCount = 0;
        for (const f of plantFeats) {
          const coords = (f.geometry as GeoJSON.Point).coordinates;
          const key    = `${coords[0].toFixed(4)},${coords[1].toFixed(4)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const ft = (f.properties?.fuel_type as string) || 'other';
          const mw = (f.properties?.capacity_mw as number) || 0;
          co2Tons += mw * (CAPACITY_FACTOR[ft] ?? 0.40) * 8760 * (CO2_KG_PER_MWH[ft] ?? 500) / 1000;
          plantCount++;
        }
        setStats({ totalDCs, mwDemand: totalDCs * 50, co2Tons, plantCount, withPPA, withoutPPA: features.length - withPPA });
      };
      map.current!.on('moveend', updateContext);
      map.current!.on('zoomend', updateContext);
      setTimeout(updateContext, 500);

      // NERC reliability zone overlay (added first = bottom of render stack)
      {
        map.current!.addSource('nerc-regions', { type: 'geojson', data: NERC_GEO });
        map.current!.addLayer({ id: 'nerc-fill', type: 'fill', source: 'nerc-regions',
          layout: { visibility: 'visible' },
          paint: {
            'fill-color': ['get', '_color'],
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.10, 8, 0.05],
          },
        });
        map.current!.addLayer({ id: 'nerc-border', type: 'line', source: 'nerc-regions',
          layout: { visibility: 'visible' },
          paint: {
            'line-color': ['get', '_color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.5, 8, 2.5],
            'line-opacity': 0.45,
          },
        });
        map.current!.addLayer({ id: 'nerc-label', type: 'symbol', source: 'nerc-regions',
          minzoom: 2.5, maxzoom: 8,
          layout: {
            visibility: 'visible',
            'text-field': ['format',
              ['get', '_label'], { 'font-scale': 1.05, 'text-font': ['literal', ['DIN Offc Pro Bold', 'Arial Unicode MS Bold']] },
              '\n', {},
              ['get', '_badge'], { 'font-scale': 0.72, 'text-font': ['literal', ['DIN Offc Pro Medium', 'Arial Unicode MS Regular']] },
            ],
            'text-font':         ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
            'text-size':         13,
            'text-justify':      'center',
            'text-anchor':       'center',
            'text-max-width':    10,
            'text-allow-overlap': false,
            'text-ignore-placement': false,
          },
          paint: {
            'text-color': ['get', '_color'],
            'text-halo-color': '#040e1f',
            'text-halo-width': 2,
            'text-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.85, 7.5, 0.65],
          },
        });
      }

      // Water stress overlay (county bounding boxes, hardcoded)
      {
        const waterGeo: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: WATER_COUNTIES.map(([x1, y1, x2, y2, stress]) => ({
            type: 'Feature' as const,
            geometry: {
              type: 'Polygon' as const,
              coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]],
            },
            properties: { _stress: stress },
          })),
        };

        map.current!.addSource('water-stress', { type: 'geojson', data: waterGeo });

        // Fill: transparent for low stress, reddening toward extremely high
        map.current!.addLayer({
          id: 'water-fill', type: 'fill', source: 'water-stress',
          layout: { visibility: 'none' }, // off by default
          paint: {
            'fill-color': ['interpolate', ['linear'], ['coalesce', ['get', '_stress'], 0],
              0, '#fbbf24',   // no data anchor (won't show — opacity 0)
              1, '#fde68a',   // low
              2, '#f97316',   // medium-high
              3, '#ef4444',   // high
              4, '#dc2626',   // very high
              5, '#7f1d1d',   // extremely high
            ],
            'fill-opacity': ['interpolate', ['linear'], ['coalesce', ['get', '_stress'], 0],
              0,   0,
              0.5, 0,      // below threshold — fully transparent
              1,   0.08,
              2,   0.14,
              3,   0.20,
              4,   0.26,
              5,   0.34,
            ],
          },
        });

        // Thin border only for high-stress counties (reduces visual noise on 3k+ polygons)
        map.current!.addLayer({
          id: 'water-border', type: 'line', source: 'water-stress',
          layout: { visibility: 'none' },
          filter: ['>=', ['coalesce', ['get', '_stress'], 0], 3],
          paint: {
            'line-color': '#ef4444',
            'line-width': 0.4,
            'line-opacity': 0.35,
          },
        });
      }

      // Power plants
      const plantsGeojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: (plantsJson.plants as any[])
          .filter(p => p.lat && p.lon && p.fuel_type !== 'other')
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
      map.current!.addLayer({ id: 'plants-glow', type: 'circle', source: 'plants', layout: { visibility: 'visible' },
        paint: { 'circle-color': fuelColorExpr, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 12, 6, 16, 10, 24], 'circle-opacity': 0.15, 'circle-blur': 1 },
      });
      map.current!.addLayer({ id: 'plants', type: 'circle', source: 'plants', layout: { visibility: 'visible' },
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
        paint: { 'circle-color': '#6366f1', 'circle-radius': ['step', ['get', 'point_count'], 22, 10, 30, 50, 38], 'circle-opacity': 0.25, 'circle-blur': 0.6 },
      });
      map.current!.addLayer({ id: 'clusters', type: 'circle', source: 'datacenters', filter: ['has', 'point_count'],
        paint: { 'circle-color': '#4f46e5', 'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 50, 30], 'circle-opacity': 0.95, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#818cf8' },
      });
      map.current!.addLayer({ id: 'cluster-count', type: 'symbol', source: 'datacenters', filter: ['has', 'point_count'],
        layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 11, 'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'] },
        paint: { 'text-color': '#e0e7ff' },
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
          'circle-stroke-width': 2, 'circle-stroke-color': '#040e1f', 'circle-stroke-opacity': 0.9,
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
          'text-halo-color': '#040e1f', 'text-halo-width': 1.5,
        },
      });

      map.current!.on('click', 'clusters', (e) => {
        const features  = map.current!.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        const clusterId = features[0].properties!.cluster_id;
        (map.current!.getSource('datacenters') as mapboxgl.GeoJSONSource).getClusterExpansionZoom(clusterId, (err, zoom) => {
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
        const features = map.current!.queryRenderedFeatures(e.point, { layers: ['unclustered', 'clusters', 'emerging-uc', 'emerging-planned'] });
        if (features.length === 0) setSelected(null);
      });
      ['clusters', 'unclustered', 'emerging-uc', 'emerging-planned'].forEach(layer => {
        map.current!.on('mouseenter', layer, () => { map.current!.getCanvas().style.cursor = 'pointer'; });
        map.current!.on('mouseleave', layer, () => { map.current!.getCanvas().style.cursor = ''; });
      });

      // ── Deep-link on load ────────────────────────────────────────────────────
      const facilityId = new URLSearchParams(window.location.search).get('facility');
      if (facilityId) {
        const target = data.find((d: any) => d.id === facilityId);
        if (target?.lat && target?.lon) {
          setSelected(target as DataCenter);
          // Delay flyTo slightly so the map finishes its initial render first
          setTimeout(() => {
            map.current?.flyTo({ center: [target.lon, target.lat], zoom: 13, duration: 2200, essential: true });
          }, 400);
        }
      }

    } catch (err) { console.error('Map load error:', err); } });
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, background: C.bg, fontFamily: SANS }}>

      {/* ── Header ── */}
      <header style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 56,
        background: `${C.bg}f2`, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', zIndex: 20, backdropFilter: 'blur(10px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div>
            <span style={{ fontFamily: SANS, fontSize: 14, fontWeight: 800, letterSpacing: '-0.025em', color: C.text, textTransform: 'uppercase' }}>
              US Data Center
            </span>
            <span style={{ fontFamily: SANS, fontSize: 14, fontWeight: 300, letterSpacing: '-0.01em', color: C.text2, marginLeft: 7 }}>
              Power Map
            </span>
          </div>
          <div style={{ width: 1, height: 18, background: C.border2, marginLeft: 2 }} />
          <div style={{ fontFamily: MONO, fontSize: 9, color: C.text3, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            AI infrastructure is an energy policy problem
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Tour button */}
          <button onClick={tourRunning ? endTour : startTour} disabled={!loaded} style={{
            fontFamily: SANS, fontSize: 12, fontWeight: 700, letterSpacing: '-0.01em',
            padding: '7px 16px', borderRadius: 5, cursor: loaded ? 'pointer' : 'default',
            border: tourRunning ? `1px solid ${C.border2}` : `1px solid ${C.green}50`,
            background: tourRunning ? C.surface2 : `${C.green}18`,
            color: tourRunning ? C.text3 : C.green,
            opacity: loaded ? 1 : 0.35, transition: 'all 0.18s',
            display: 'flex', alignItems: 'center', gap: 7,
          }}>
            {tourRunning ? <><span style={{ fontSize: 10 }}>✕</span> End Tour</> : <><span style={{ fontSize: 11 }}>▶</span> Show me the story</>}
          </button>

          <div style={{ width: 1, height: 16, background: C.border }} />

          {/* Plants quick toggle */}
          <button onClick={() => setShowPlants(v => !v)} style={{
            fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: '0.1em',
            padding: '5px 13px', borderRadius: 4, cursor: 'pointer',
            border: `1px solid ${showPlants ? C.border2 : C.border}`,
            background: showPlants ? C.surface3 : 'transparent',
            color: showPlants ? C.text2 : C.text3,
            textTransform: 'uppercase', transition: 'all 0.15s',
          }}>
            ⚡ Plants {showPlants ? 'On' : 'Off'}
          </button>

          {/* Layers panel button */}
          <button onClick={() => { setLayerPanelOpen(v => !v); setAboutOpen(false); }} style={{
            fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: '0.1em',
            padding: '5px 13px', borderRadius: 4, cursor: 'pointer',
            border: `1px solid ${layerPanelOpen ? C.border2 : C.border}`,
            background: layerPanelOpen ? C.surface3 : 'transparent',
            color: layerPanelOpen ? C.text : C.text3,
            textTransform: 'uppercase', transition: 'all 0.15s',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <svg width="12" height="10" viewBox="0 0 12 10" fill="none" style={{ opacity: layerPanelOpen ? 1 : 0.6 }}>
              <rect y="0" width="12" height="1.5" rx="0.75" fill="currentColor"/>
              <rect y="4.25" width="12" height="1.5" rx="0.75" fill="currentColor"/>
              <rect y="8.5" width="12" height="1.5" rx="0.75" fill="currentColor"/>
            </svg>
            Layers
          </button>

          {/* Search button */}
          <button
            onClick={() => setSearchOpen(v => !v)}
            disabled={!loaded}
            title="Search facilities"
            style={{
              width: 30, height: 30, borderRadius: 5, flexShrink: 0,
              background: searchOpen ? C.surface3 : 'transparent',
              border: `1px solid ${searchOpen ? C.border2 : C.border}`,
              color: searchOpen ? C.text : C.text3,
              cursor: loaded ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: loaded ? 1 : 0.35, transition: 'all 0.15s',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="9.5" y1="9.5" x2="13" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>

          <div style={{ width: 1, height: 16, background: C.border }} />

          {loaded && (
            <div style={{ fontFamily: MONO, fontSize: 11, color: C.text3 }}>
              <span style={{ color: C.green, fontWeight: 700 }}>{total.toLocaleString()}</span>
              <span style={{ marginLeft: 5 }}>facilities</span>
            </div>
          )}
          <div style={{ fontFamily: MONO, fontSize: 9, color: C.text3, letterSpacing: '0.06em' }}>
            PNNL IM3 · EIA 860/923 · 2023
          </div>

          {/* Methodology & About */}
          <button
            onClick={() => { setAboutOpen(v => !v); setLayerPanelOpen(false); }}
            title="Methodology & about"
            style={{
              fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: '0.1em',
              padding: '5px 11px', borderRadius: 4, cursor: 'pointer',
              border: `1px solid ${aboutOpen ? C.border2 : C.border}`,
              background: aboutOpen ? C.surface3 : 'transparent',
              color: aboutOpen ? C.text2 : C.text3,
              textTransform: 'uppercase', transition: 'all 0.15s',
            }}
          >About</button>

          {/* Reopen splash */}
          <button
            onClick={reopenSplash}
            title="Reopen intro"
            style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.text3, cursor: 'pointer',
              fontFamily: MONO, fontSize: 11, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1, transition: 'border-color 0.15s, color 0.15s',
            }}
          >?</button>
        </div>
      </header>

      {/* ── Context bar ── */}
      {context && (
        <div style={{
          position: 'absolute', top: 56, left: 0, right: 0, height: 30,
          background: C.surface, borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center',
          padding: '0 24px', gap: 18, zIndex: 15,
        }}>
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.text, letterSpacing: '0.02em' }}>{context.region}</span>
          <div style={{ width: 1, height: 12, background: C.border2 }} />
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.text3 }}>
            <span style={{ color: C.green, fontWeight: 700 }}>{context.count}</span> facilities in view
          </span>
          {ppasOnly && (
            <>
              <div style={{ width: 1, height: 12, background: C.border2 }} />
              <span style={{ fontFamily: MONO, fontSize: 9, color: FUEL.nuclear, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                ⚡ PPAs only
              </span>
            </>
          )}
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

      {stats && <StatsStrip stats={stats} expanded={statsExpanded} />}

      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

      {selected && (
        <DetailPanel
          dc={selected}
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

      {/* Layer panel — always mounted, slides in/out */}
      <LayerPanel
        open={layerPanelOpen}
        showDataCenters={showDataCenters} onToggleDC={() => setShowDataCenters(v => !v)}
        showPlants={showPlants}           onTogglePlants={() => setShowPlants(v => !v)}
        showPlanned={showPlanned}         onTogglePlanned={() => setShowPlanned(v => !v)}
        showNerc={showNerc}               onToggleNerc={() => setShowNerc(v => !v)}
        showWater={showWater}             onToggleWater={() => setShowWater(v => !v)}
        activeFuels={activeFuels}         onToggleFuel={toggleFuel}
        ppasOnly={ppasOnly}               onTogglePpasOnly={() => setPpasOnly(v => !v)}
        topOffset={86 + (stats && statsExpanded ? 30 : 0)}
      />

      {/* Overlay to close layer panel on outside click */}
      {layerPanelOpen && (
        <div
          onClick={() => setLayerPanelOpen(false)}
          style={{ position: 'absolute', inset: 0, zIndex: 11 }}
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

      <Legend showPlants={showPlants} showPlanned={showPlanned} />

      {/* Search overlay */}
      {searchOpen && (
        <SearchOverlay
          dcs={allDcData.current}
          plants={allPlantsData.current}
          onSelectDc={dc => {
            setSelected(dc);
            setSearchOpen(false);
            setLayerPanelOpen(false);
            map.current?.flyTo({ center: [dc.lon, dc.lat], zoom: 13, duration: 1800, essential: true });
          }}
          onSelectPlant={p => {
            setSearchOpen(false);
            map.current?.flyTo({ center: [p.lon, p.lat], zoom: 11, duration: 1800, essential: true });
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {/* Splash screen */}
      {splashVisible && <SplashScreen fading={splashFading} onDismiss={dismissSplash} />}
    </div>
  );
}
