// Builds src/data/us-states.json: a simplified outline of the U.S. states used
// as the map's fallback layer when tiles are slow or unavailable.
//
//   node scripts/build_outlines.mjs      (npm run outlines)
//
// Source: us-atlas "states-10m" (derived from Census cartographic boundary
// files). The full file is about 115 kB; the game only needs a rough outline.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { quantize } from 'topojson-client';
import { filter, filterWeight, presimplify, quantile, simplify } from 'topojson-simplify';

const require = createRequire(import.meta.url);
const source = JSON.parse(readFileSync(require.resolve('us-atlas/states-10m.json'), 'utf8'));

// Drop specks (tiny islands), keep the 8% most significant points, then store
// coordinates on a coarse grid. Good for a country-wide view; not for close-ups.
const weighted = presimplify(source);
const minWeight = quantile(weighted, 0.08); // weight above which 8% of points lie
const simplified = filter(simplify(weighted, minWeight), filterWeight(weighted, minWeight));
const { states } = simplified.objects;
for (const g of states.geometries) delete g.properties;
const small = quantize({ ...simplified, objects: { states } }, 3000);

const out = new URL('../src/data/us-states.json', import.meta.url);
const json = JSON.stringify(small);
writeFileSync(out, json + '\n');
console.log(`us-states.json: ${(json.length / 1024).toFixed(1)} kB, ${small.arcs.length} arcs`);
