#!/usr/bin/env node
/**
 * Build us-cities.json from official US Census Bureau data.
 *
 * Sources (both from census.gov):
 *   1. 2024 Gazetteer Places file — city names, state, lat/lng
 *      https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/
 *   2. Sub-county Population Estimates (Vintage 2024) — population by place
 *      https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/cities/totals/
 *
 * Output: lib/data/us-cities.json
 */

const fs = require('fs');
const path = require('path');

const GAZ_PATH = '/tmp/2024_Gaz_place_national.txt';
const POP_PATH = '/tmp/sub-est2024.csv';
const OUT_PATH = path.join(__dirname, '..', 'lib', 'data', 'us-cities.json');

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
  PR: 'Puerto Rico', VI: 'Virgin Islands',
};

// Parse tab-delimited gazetteer (has USPS, GEOID, NAME, LSAD, FUNCSTAT, lat, lng)
function parseGazetteer() {
  const raw = fs.readFileSync(GAZ_PATH, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim());
  const header = lines[0].split('\t').map(h => h.trim());

  const idxUSPS = header.indexOf('USPS');
  const idxGEOID = header.indexOf('GEOID');
  const idxNAME = header.indexOf('NAME');
  const idxLSAD = header.indexOf('LSAD');
  const idxFUNC = header.indexOf('FUNCSTAT');
  const idxLAT = header.indexOf('INTPTLAT');
  const idxLNG = header.indexOf('INTPTLONG');

  const places = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t').map(c => c.trim());
    const stateId = cols[idxUSPS];
    const geoid = cols[idxGEOID];
    const fullName = cols[idxNAME];
    const lsad = cols[idxLSAD];
    const funcstat = cols[idxFUNC];
    const lat = parseFloat(cols[idxLAT]);
    const lng = parseFloat(cols[idxLNG]);

    // Only include active (A) or fictional/statistical (S for CDPs) places in the 50 states + DC
    if (!stateId || !STATE_NAMES[stateId]) continue;
    if (funcstat !== 'A' && funcstat !== 'S') continue;
    if (isNaN(lat) || isNaN(lng)) continue;

    // Strip the LSAD suffix from name (e.g., "Abbeville city" -> "Abbeville")
    const name = fullName
      .replace(/\s+(city|town|village|borough|CDP|municipality|city and borough|unified government|metro government|consolidated government|urban county)$/i, '')
      .trim();

    // Extract the 5-digit place FIPS from the full GEOID (last 5 chars)
    const placeFips = geoid.slice(-5);

    places.push({
      city: name,
      state_id: stateId,
      state_name: STATE_NAMES[stateId],
      lat: Math.round(lat * 10000) / 10000,
      lng: Math.round(lng * 10000) / 10000,
      geoid,
      place_fips: placeFips,
      state_fips: geoid.slice(0, 2),
      population: 0,
    });
  }
  return places;
}

// Parse CSV population estimates — keyed by STATE FIPS + PLACE FIPS
function parsePopulation() {
  const raw = fs.readFileSync(POP_PATH, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim());
  const header = lines[0].split(',');

  const idxSumlev = header.indexOf('SUMLEV');
  const idxState = header.indexOf('STATE');
  const idxPlace = header.indexOf('PLACE');
  const idxPop = header.indexOf('POPESTIMATE2024');
  const idxFuncstat = header.indexOf('FUNCSTAT');

  const popMap = new Map(); // "STATE_FIPS|PLACE_FIPS" -> population
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const sumlev = cols[idxSumlev];
    // SUMLEV 162 = incorporated place, 170 = consolidated city
    if (sumlev !== '162' && sumlev !== '170') continue;
    const stateFips = cols[idxState];
    const placeFips = cols[idxPlace];
    const pop = parseInt(cols[idxPop], 10) || 0;
    popMap.set(`${stateFips}|${placeFips}`, pop);
  }
  return popMap;
}

function main() {
  console.log('Parsing Census Gazetteer...');
  const places = parseGazetteer();
  console.log(`  Found ${places.length} places`);

  console.log('Parsing Population Estimates...');
  const popMap = parsePopulation();
  console.log(`  Found ${popMap.size} population records`);

  // Merge population into places
  let matched = 0;
  for (const place of places) {
    const key = `${place.state_fips}|${place.place_fips}`;
    if (popMap.has(key)) {
      place.population = popMap.get(key);
      matched++;
    }
  }
  console.log(`  Matched population for ${matched}/${places.length} places`);

  // Sort by population descending (most common cities first for autocomplete)
  places.sort((a, b) => b.population - a.population);

  // Strip internal fields before output
  const output = places.map(p => ({
    city: p.city,
    state_id: p.state_id,
    state_name: p.state_name,
    lat: p.lat,
    lng: p.lng,
    population: p.population,
  }));

  // Deduplicate — same city name + state_id, keep the one with higher population
  const seen = new Set();
  const deduped = [];
  for (const entry of output) {
    const key = `${entry.city.toLowerCase()}|${entry.state_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }

  console.log(`  Deduped: ${output.length} -> ${deduped.length} unique city+state pairs`);

  fs.writeFileSync(OUT_PATH, JSON.stringify(deduped));
  const sizeMB = (fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(2);
  console.log(`\nWrote ${deduped.length} cities to ${OUT_PATH} (${sizeMB} MB)`);
}

main();
