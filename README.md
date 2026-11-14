# 🏙️ CensusGuessr

Identify a U.S. city from Census clues, then watch the map fly from your guess to the answer.

- **Daily Challenge** — one city a day, the same for everyone, resetting at 00:00 UTC.
- **Practice** — unlimited random rounds.
- Static site: React + TypeScript + Vite + Leaflet. No backend, no API keys, no live Census calls.

## How it plays

1. The first clue is visible. Search for a city (the list shows city and state, so the three
   Springfields stay distinct) and pick one to drop a preview pin, or **Reveal next clue**.
2. Up to eight clues appear in this order: median age, work-from-home share, median home value,
   bike-or-transit commute share, most common reported ancestry, share born in a different U.S.
   state, median year housing was built, Census region. Revealing a clue never moves the map.
3. **Submit guess** locks it in. The map zooms to your guess, pulls back if you were far off,
   flies to the actual city, then frames both pins with a dashed line. **Skip animation** (or
   <kbd>Esc</kbd>) jumps to the end; **View answer** and **Show both** replay the camera.
4. **Copy result** shares a spoiler-free line:
   `🏙️ CensusGuessr #42 · 🧩 3/8 clues · 📍 87 km · ⭐ 3,361/5,000`

### Scoring

```ts
Math.round(5000 * Math.exp(-distanceKm / 500) * (1 - 0.10 * (cluesUsed - 1)))
```

Distance is the Haversine great-circle distance between the two places' Gazetteer internal
points. An exact guess on clue one earns 5,000; each extra clue lowers the maximum by 500.

## Run it locally

Requires Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (scoring, distance, schedule, search, data)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

## Deploy to GitHub Pages

The build uses relative asset paths, so it works at `https://<user>.github.io/<repo>/` with no
configuration.

1. Create a GitHub repository and push this project to its `main` branch:
   ```bash
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin main
   ```
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml`: `npm ci`, `npm test`,
   `npm run build`, then publishes `dist/`.

## Data

The app ships a committed snapshot, [`src/data/cities.json`](src/data/cities.json).

| | Source | Vintage |
|---|---|---|
| Clue estimates | [ACS 5-year table-based Summary File](https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/) | **ACS 5-year 2020–2024** (all clues) |
| Table definitions | [ACS 2024 5-year table shells](https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/documentation/ACS20245YR_Table_Shells.txt) | 2024 |
| Coordinates | [Census Gazetteer, places file](https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_place_national.zip) | **2025 Gazetteer** |
| Regions | [Census regions and divisions](https://www2.census.gov/geo/pdfs/maps-data/maps/reference/us_regdiv.pdf) | — |

Regenerate it (Python 3.9+, standard library only; downloads about 400 MB once and caches the
place rows in `.cache/`):

```bash
npm run data       # = python3 scripts/prepare_data.py
```

The script reads the Summary File directly rather than the Census Data API, because the API now
requires a key. Rows are joined on the 7-digit **state + place FIPS** code: ACS `GEO_ID`
`1600000US` + `SSPPPPP` (summary level 160) to the Gazetteer `GEOID`.

### Clue definitions

Table IDs, line labels and universes are asserted against the official table shells on every
run, so a renumbered table fails loudly.

| Clue | Calculation | Universe (denominator) |
|---|---|---|
| Median age | `B01002_001` | Total population |
| Work from home | `B08301_021` ÷ `B08301_001` | Workers 16 years and over |
| Median home value | `B25077_001` | Owner-occupied housing units |
| Bike or public transit | (`B08301_010` public transportation + `B08301_018` bicycle) ÷ `B08301_001` | Workers 16 years and over |
| Most common ancestry | largest eligible line of `B04006` (below) | Total population |
| Born in a different U.S. state | `B05002_004` ÷ `B05002_001` | Total population |
| Median year housing built | `B25035_001` | Housing units |
| Census region | from the state FIPS code | — |

Population for the 100,000 threshold is `B01003_001` from the same release.

- **Public transit** is the ACS "Public transportation" line: bus, subway or elevated rail,
  long-distance train or commuter rail, light rail/streetcar/trolley, and ferryboat. Taxi and
  ride-hailing are a separate line and are not included.
- **Top ancestry.** `B04006` ("People Reporting Ancestry") counts each person once under every
  ancestry they reported, first or second. The candidates are its 70 top-level lines, with the
  group lines *Arab*, *Subsaharan African* and *West Indian (except Hispanic groups)* each
  competing as one category instead of through their components. The two residual lines are
  excluded: *Other groups* (`B04006_108`, a combined bucket that is not one ancestry and holds
  most Hispanic, Asian, Black/African American, American Indian and Pacific Islander responses)
  and *Unclassified or not reported* (`B04006_109`). The largest estimate wins; ties go to the
  earlier table line. So this clue is "the largest single ancestry group the table itemizes",
  which in practice is mostly European, "American", Sub-Saharan African, West Indian or Arab.
- **Born in a different U.S. state** is `B05002_004`, "Native: Born in other state in the United
  States", over the total population. It excludes people born in their state of residence,
  people born in Puerto Rico, the U.S. Island Areas or abroad to American parents, and the
  foreign-born. The numerator is *not* `_003`, which is "Born in state of residence".
- **Bottom/top codes.** A median year built at or below 1939 is stored as 1939 and shown as
  "1939 or earlier" (5 cities). A median home value at the $2,000,000 top code would be shown as
  "$2,000,000+" (none currently).

### Pool and exclusions

| | Count |
|---|---|
| Places in ACS 2020–2024 (summary level 160) | 32,330 |
| With at least 100,000 residents | 351 |
| Excluded | 4 |
| **Playable cities** | **347** |

The four exclusions are Puerto Rico's *zonas urbanas* (San Juan, Bayamón, Carolina, Ponce):
Puerto Rico is not assigned to a Census region, so they have no value for the eighth clue. No
place was dropped for a missing or suppressed estimate. The machine-readable report is
[`data/exclusions.json`](data/exclusions.json).

"Named places" includes census-designated places such as Arlington, VA and Paradise, NV. Display
names drop the Census suffix ("city", "CDP", "(balance)"…) and a few consolidated governments are
shortened (Nashville-Davidson → Nashville, Urban Honolulu → Honolulu); the original is kept as
`censusName`. The script asserts that every "City, ST" label is unique.

### Daily schedule

- Puzzle **#1** started at **2026-11-14 00:00 UTC**; the number goes up by one at every 00:00 UTC.
- [`src/data/schedule.json`](src/data/schedule.json) holds versioned schedules. Each version
  freezes its own pool of GEOIDs and a seed; puzzle *n* is the *n*-th city of a seeded shuffle of
  that pool (reshuffled after each full pass). The answer therefore depends only on the puzzle
  number and the schedule, not on the current data file.
- `npm run data` never rewrites the schedule. If a data refresh adds or removes cities, append a
  new entry to `versions` with the next `version`, a new `seed`, the new `pool`, and a
  `startPuzzle` in the future. Earlier puzzle numbers keep their cities (covered by a unit test).
- Progress (clues revealed, then the result) is saved in `localStorage` under
  `censusguessr.daily.v1`, so a refresh restores your place.

## Map

Tiles come from OpenStreetMap's standard tile layer, with the required
"© OpenStreetMap contributors" attribution shown on the map. That service is fine for a small
hobby deployment under its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/);
for heavier traffic, build with another provider:

```bash
VITE_TILE_URL="https://example.com/{z}/{x}/{y}.png" VITE_TILE_ATTRIBUTION="© Example" npm run build
```

U.S. state outlines (from [`us-atlas`](https://github.com/topojson/us-atlas), derived from Census
cartographic boundary files) are bundled and drawn under the tiles, so pins, labels, score and
distance stay readable if tiles fail to load.

Camera moves are instant when the OS "reduce motion" setting is on. Adding `?reducedMotion=1` to
the URL forces the same behaviour.

## Limitations

- ACS figures are sample estimates with margins of error, which the game does not show.
- Distances are between Gazetteer internal points, not downtowns or city halls.
- The ancestry clue cannot return groups the Census folds into "Other groups" (see above).
- The daily puzzle is computed in the browser, so the answer is discoverable by reading the code,
  and a player's clock decides which puzzle they see.

## License

Code: [MIT](LICENSE). Census Bureau data is in the public domain. This product uses Census Bureau
data but is not endorsed or certified by the Census Bureau. Map data © OpenStreetMap contributors
(ODbL).
