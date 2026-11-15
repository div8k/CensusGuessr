#!/usr/bin/env python3
"""Build src/data/cities.json for CensusGuessr.

Joins ACS 5-year place estimates (table-based Summary File, no API key needed)
with Census Gazetteer place coordinates on the 7-digit state+place FIPS code.

Usage:  python3 scripts/prepare_data.py            (standard library only)

Downloads are streamed and only place rows (summary level 160) are cached in
.cache/, so re-runs are fast and offline.
"""
from __future__ import annotations

import csv
import io
import json
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ACS_YEAR = 2024  # ACS 5-year release 2020-2024; every clue estimate uses this release
GAZETTEER_YEAR = 2025  # coordinates only; recorded separately from the ACS vintage
MIN_POPULATION = 100_000
YEAR_BUILT_FLOOR = 1939  # displayed as "1939 or earlier"
HOME_VALUE_CAP = 2_000_000  # displayed as "$2,000,000+"

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
OUT = ROOT / "src" / "data" / "cities.json"
REPORT = ROOT / "data" / "exclusions.json"
FEATURED = ROOT / "data" / "featured_cities.csv"
SCHEDULE = ROOT / "src" / "data" / "schedule.json"
SCHEDULE_EPOCH_UTC = "2026-11-14"  # 00:00 UTC on this date starts puzzle #1

ACS_BASE = (
    f"https://www2.census.gov/programs-surveys/acs/summary_file/{ACS_YEAR}"
    "/table-based-SF"
)
ACS_DATA = ACS_BASE + f"/data/5YRData/acsdt5y{ACS_YEAR}-{{table}}.dat"
ACS_SHELLS = ACS_BASE + f"/documentation/ACS{ACS_YEAR}5YR_Table_Shells.txt"
GAZ_URL = (
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/"
    f"{GAZETTEER_YEAR}_Gazetteer/{GAZETTEER_YEAR}_Gaz_place_national.zip"
)

PLACE_PREFIX = "1600000US"  # summary level 160 (state-place), geographic component 00
TABLES = ["b01003", "b01002", "b08301", "b25077", "b04006", "b05002", "b25035"]

# Labels we rely on, checked against the official table shells on every run so a
# renumbered table in a future release fails loudly instead of silently.
EXPECTED_LABELS = {
    "B01003_001": "Total",
    "B01002_001": "Total:",
    "B08301_001": "Total:",
    "B08301_010": "Public transportation:",
    "B08301_018": "Bicycle",
    "B08301_021": "Worked from home",
    "B25077_001": "Median value (dollars)",
    "B04006_001": "Total:",
    "B04006_108": "Other groups",
    "B04006_109": "Unclassified or not reported",
    "B05002_001": "Total:",
    "B05002_004": "Born in other state in the United States:",
    "B25035_001": "Median year structure built",
}
EXPECTED_UNIVERSE = {
    "B01002": "Total population",
    "B08301": "Workers 16 years and over",
    "B25077": "Owner-occupied housing units",
    "B04006": "Total population",
    "B05002": "Total population",
    "B25035": "Housing units",
}

# Census regions by state FIPS (https://www2.census.gov/geo/pdfs/maps-data/maps/reference/us_regdiv.pdf)
REGIONS = {
    "Northeast": "09 23 25 33 44 50 34 36 42",
    "Midwest": "17 18 26 39 55 19 20 27 29 31 38 46",
    "South": "10 11 12 13 24 37 45 51 54 01 21 28 47 05 22 40 48",
    "West": "04 08 16 30 32 35 49 56 02 06 15 41 53",
}
STATE_REGION = {fips: region for region, s in REGIONS.items() for fips in s.split()}

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan",
    "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota",
    "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
    "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "PR": "Puerto Rico",
}

# Census legal/statistical suffixes removed to get the everyday city name.
NAME_SUFFIXES = [
    " (balance)",
    " metropolitan government",
    " consolidated government",
    " unified government",
    " metro government",
    " urban county",
    " city and borough",
    " municipality",
    " zona urbana",
    " borough",
    " village",
    " city",
    " town",
    " CDP",
]
NAME_OVERRIDES = {
    "Urban Honolulu": "Honolulu",
    "Nashville-Davidson": "Nashville",
    "Louisville/Jefferson County": "Louisville",
    "Lexington-Fayette": "Lexington",
    "Augusta-Richmond County": "Augusta",
    "Macon-Bibb County": "Macon",
    "Athens-Clarke County": "Athens",
    "Indianapolis city": "Indianapolis",
    "Boise City": "Boise",
    "San Buenaventura (Ventura)": "Ventura",
}


def open_url(url: str):
    """Open a URL as a binary stream.

    Prefers curl (uses the OS trust store, so it works on python.org macOS builds
    that ship without CA certificates) and falls back to urllib.
    """
    if shutil.which("curl"):
        proc = subprocess.Popen(
            ["curl", "-fsSL", "--retry", "3", "-A", "censusguessr-data-prep", url],
            stdout=subprocess.PIPE,
        )
        return proc, proc.stdout
    req = urllib.request.Request(url, headers={"User-Agent": "censusguessr-data-prep"})
    return None, urllib.request.urlopen(req, timeout=120)


def close_url(proc, stream, url: str) -> None:
    stream.close()
    if proc is not None and proc.wait() != 0:
        sys.exit(f"Download failed (curl exit {proc.returncode}): {url}")


def fetch(url: str) -> bytes:
    proc, stream = open_url(url)
    body = stream.read()
    close_url(proc, stream, url)
    return body


def place_rows(table: str) -> tuple[list[str], dict[str, list[str]]]:
    """Return (header, {7-digit GEOID: row}) for place rows of one ACS table."""
    cache = CACHE / f"acs{ACS_YEAR}_5yr_{table}_places.psv"
    if not cache.exists():
        url = ACS_DATA.format(table=table)
        print(f"  downloading {url}", file=sys.stderr)
        CACHE.mkdir(exist_ok=True)
        tmp = cache.with_suffix(".part")
        proc, stream = open_url(url)
        with tmp.open("w", encoding="utf-8") as out:
            text = io.TextIOWrapper(stream, encoding="utf-8", newline="")
            out.write(next(text))
            for line in text:
                if line.startswith(PLACE_PREFIX):
                    out.write(line)
        close_url(proc, text, url)
        tmp.rename(cache)
    with cache.open(encoding="utf-8") as f:
        header = f.readline().rstrip("\r\n").split("|")
        rows = {}
        for line in f:
            parts = line.rstrip("\r\n").split("|")
            rows[parts[0][len(PLACE_PREFIX):]] = parts
    return header, rows


def load_shells() -> dict[str, dict]:
    cache = CACHE / f"ACS{ACS_YEAR}5YR_Table_Shells.txt"
    if not cache.exists():
        CACHE.mkdir(exist_ok=True)
        cache.write_bytes(fetch(ACS_SHELLS))
    shells = {}
    with cache.open(encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f, delimiter="|"):
            if row["Unique ID"]:
                shells[row["Unique ID"]] = row
    return shells


def verify_shells(shells: dict[str, dict]) -> None:
    for uid, label in EXPECTED_LABELS.items():
        got = shells[uid]["Label"].strip()
        if got != label:
            sys.exit(f"Table shell mismatch for {uid}: expected {label!r}, got {got!r}")
    for table, universe in EXPECTED_UNIVERSE.items():
        got = shells[f"{table}_001"]["Universe"].strip()
        if got != universe:
            sys.exit(f"Universe mismatch for {table}: expected {universe!r}, got {got!r}")


def ancestry_candidates(shells: dict[str, dict]) -> dict[str, str]:
    """Top-level (indent 1) B04006 lines, minus the two residual lines.

    Group subtotals (Arab, Subsaharan African, West Indian) compete as one
    category each; their indent-2 components are not separate candidates.
    """
    out = {}
    for uid, row in shells.items():
        if row["Table ID"] != "B04006" or row["Indent"] != "1":
            continue
        if uid in ("B04006_108", "B04006_109"):
            continue
        label = row["Label"].strip().rstrip(":")
        label = {
            "French (except Basque)": "French",
            "West Indian (except Hispanic groups)": "West Indian",
            "Subsaharan African": "Sub-Saharan African",
        }.get(label, label)
        out[uid] = label
    return out


def load_gazetteer() -> dict[str, dict]:
    cache = CACHE / f"{GAZETTEER_YEAR}_Gaz_place_national.zip"
    if not cache.exists():
        CACHE.mkdir(exist_ok=True)
        print(f"  downloading {GAZ_URL}", file=sys.stderr)
        cache.write_bytes(fetch(GAZ_URL))
    with zipfile.ZipFile(cache) as z:
        name = next(n for n in z.namelist() if n.endswith(".txt"))
        text = z.read(name).decode("utf-8", errors="replace")
    first = text.split("\n", 1)[0]
    delim = "|" if first.count("|") > first.count("\t") else "\t"
    out = {}
    for row in csv.DictReader(io.StringIO(text), delimiter=delim):
        row = {k.strip(): (v or "").strip() for k, v in row.items() if k}
        out[row["GEOID"]] = row
    return out


def clean_name(raw: str) -> str:
    name = raw
    changed = True
    while changed:
        changed = False
        for suffix in NAME_SUFFIXES:
            if name.endswith(suffix):
                name = name[: -len(suffix)]
                changed = True
    return NAME_OVERRIDES.get(name, name)


def check_schedule(ids: list[str]) -> None:
    """Create the daily schedule once; never rewrite it.

    The schedule freezes the pool of GEOIDs each version draws from, so a data
    refresh cannot change which city any past (or already-announced) puzzle
    used. To change the pool, append a new version by hand with a startPuzzle in
    the future (see README, "Daily schedule").
    """
    if not SCHEDULE.exists():
        schedule = {
            "epochUtc": SCHEDULE_EPOCH_UTC,
            "versions": [
                {"version": 1, "startPuzzle": 1, "seed": "censusguessr-v1", "pool": sorted(ids)}
            ],
        }
        SCHEDULE.write_text(json.dumps(schedule, separators=(",", ":")) + "\n")
        print(f"Created {SCHEDULE.relative_to(ROOT)} (version 1, {len(ids)} cities)")
        return
    schedule = json.loads(SCHEDULE.read_text())
    latest = schedule["versions"][-1]
    have = set(ids)
    gone = [g for g in latest["pool"] if g not in have]
    new = sorted(have - set(latest["pool"]))
    if gone:
        print(
            f"WARNING: {len(gone)} GEOID(s) in schedule version {latest['version']} are no longer "
            f"in the snapshot: {gone}. Append a new schedule version before deploying."
        )
    if new:
        print(
            f"Note: {len(new)} snapshot cities are not in schedule version {latest['version']} "
            "(Practice only until a new version is appended)."
        )


def load_featured() -> list[tuple[str, str]]:
    """The editorial list of well-known cities, as (display name, USPS state)."""
    out = []
    for line in FEATURED.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, state = line.rsplit(",", 1)
        out.append((name.strip(), state.strip()))
    if len(out) != len(set(out)):
        sys.exit(f"Duplicate entries in {FEATURED.name}")
    return out


def main() -> None:
    shells = load_shells()
    verify_shells(shells)
    ancestries = ancestry_candidates(shells)
    gaz = load_gazetteer()

    data = {}
    for t in TABLES:
        header, rows = place_rows(t)
        data[t.upper()] = (
            {h: i for i, h in enumerate(header)},
            rows,
        )

    def val(geoid: str, uid: str) -> float | None:
        """Estimate for a Unique ID such as B08301_021; None if missing/suppressed."""
        table, line = uid.split("_")
        cols, rows = data[table]
        row = rows.get(geoid)
        if row is None:
            return None
        raw = row[cols[f"{table}_E{line}"]].strip()
        if raw == "":
            return None
        try:
            x = float(raw)
        except ValueError:
            return None
        return None if x < 0 else x  # negative values are ACS jam codes

    pop_cols, pop_rows = data["B01003"]
    total_places = len(pop_rows)
    candidates = [g for g in pop_rows if (val(g, "B01003_001") or 0) >= MIN_POPULATION]

    cities, excluded = [], []
    for geoid in sorted(candidates):
        g = gaz.get(geoid)
        raw_name = g["NAME"] if g else geoid
        pop = int(val(geoid, "B01003_001"))

        def drop(reason: str) -> None:
            excluded.append({"geoid": geoid, "name": raw_name, "population": pop, "reason": reason})

        if g is None:
            drop(f"no {GAZETTEER_YEAR} Gazetteer record for this state+place FIPS")
            continue
        region = STATE_REGION.get(geoid[:2])
        if region is None:
            drop("state-equivalent is not assigned to a Census region (Puerto Rico)")
            continue

        workers = val(geoid, "B08301_001")
        wfh = val(geoid, "B08301_021")
        transit = val(geoid, "B08301_010")
        bike = val(geoid, "B08301_018")
        total = val(geoid, "B05002_001")
        other_state = val(geoid, "B05002_004")
        age = val(geoid, "B01002_001")
        home = val(geoid, "B25077_001")
        built = val(geoid, "B25035_001")
        counts = {uid: val(geoid, uid) for uid in ancestries}

        missing = [
            label
            for label, ok in [
                ("median age", age is not None),
                ("work from home share", bool(workers) and wfh is not None),
                ("median home value", home is not None),
                ("bike/transit share", bool(workers) and transit is not None and bike is not None),
                ("ancestry", all(v is not None for v in counts.values()) and max(counts.values()) > 0),
                ("born in another state share", bool(total) and other_state is not None),
                ("median year built", built is not None and built > 0),
            ]
            if not ok
        ]
        if missing:
            drop("missing or suppressed: " + ", ".join(missing))
            continue

        # Highest estimate wins; ties broken by table line order for determinism.
        top_uid = max(sorted(counts), key=lambda u: counts[u])
        try:
            lat, lon = float(g["INTPTLAT"]), float(g["INTPTLONG"])
        except (KeyError, ValueError):
            drop("Gazetteer record has no valid internal point")
            continue

        cities.append(
            {
                "id": geoid,
                "name": clean_name(raw_name),
                "censusName": raw_name,
                "state": g["USPS"],
                "stateName": STATE_NAMES[g["USPS"]],
                "lat": round(lat, 4),
                "lon": round(lon, 4),
                "pop": pop,
                "medianAge": age,
                "wfhPct": round(100 * wfh / workers, 1),
                # Top-coded medians (2,000,001 = "$2,000,000+") are capped; the app
                # renders the cap with a trailing plus sign.
                "homeValue": min(int(home), HOME_VALUE_CAP),
                "transitBikePct": round(100 * (transit + bike) / workers, 1),
                "ancestry": ancestries[top_uid],
                "otherStatePct": round(100 * other_state / total, 1),
                # ACS bottom-codes this median; anything at or below 1939 means
                # "1939 or earlier" and is stored as 1939 (the app shows it that way).
                "yearBuilt": max(int(built), YEAR_BUILT_FLOOR),
                "region": region,
            }
        )

    # Keep only the featured (famous) cities. Every featured city must already
    # have passed the population and data checks above, or the run fails.
    eligible = len(cities)
    featured = load_featured()
    by_label = {(c["name"], c["state"]): c for c in cities}
    unknown = [f"{n}, {s}" for n, s in featured if (n, s) not in by_label]
    if unknown:
        sys.exit(f"Featured cities not found among eligible places: {unknown}")
    wanted = set(featured)
    not_featured = [
        {"geoid": c["id"], "name": c["censusName"], "population": c["pop"]}
        for c in cities
        if (c["name"], c["state"]) not in wanted
    ]
    cities = [c for c in cities if (c["name"], c["state"]) in wanted]

    # Validation of the snapshot itself.
    ids = [c["id"] for c in cities]
    assert len(ids) == len(set(ids)), "duplicate GEOIDs"
    keys = [(c["name"], c["state"]) for c in cities]
    dupes = {k for k in keys if keys.count(k) > 1}
    assert not dupes, f"city+state labels must be unique for autocomplete: {dupes}"
    for c in cities:
        assert 17 < c["lat"] < 72 and -180 < c["lon"] < -64, c
        assert 15 < c["medianAge"] < 80, c
        for k in ("wfhPct", "transitBikePct", "otherStatePct"):
            assert 0 <= c[k] <= 100, c
        assert 10_000 < c["homeValue"], c
        assert 1939 <= c["yearBuilt"] <= ACS_YEAR, c
        assert c["region"] in REGIONS, c

    cities.sort(key=lambda c: c["id"])
    snapshot = {
        "meta": {
            "acs": {
                "release": f"ACS 5-year {ACS_YEAR - 4}-{ACS_YEAR}",
                "year": ACS_YEAR,
                "source": ACS_BASE + "/",
            },
            "gazetteer": {"year": GAZETTEER_YEAR, "source": GAZ_URL},
            "minPopulation": MIN_POPULATION,
            "placesInAcs": total_places,
            "candidates": len(candidates),
            "excluded": len(excluded),
            "eligible": eligible,
            "notFeatured": len(not_featured),
            "count": len(cities),
        },
        "cities": cities,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as f:
        f.write('{"meta":' + json.dumps(snapshot["meta"], separators=(",", ":")) + ',"cities":[\n')
        f.write(",\n".join(json.dumps(c, separators=(",", ":"), ensure_ascii=False) for c in cities))
        f.write("\n]}\n")
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(
            {"meta": snapshot["meta"], "excluded": excluded, "notFeatured": not_featured}, indent=2
        ) + "\n")

    check_schedule([c["id"] for c in cities])

    print(f"ACS {ACS_YEAR} 5-year places (summary level 160): {total_places}")
    print(f"Places with population >= {MIN_POPULATION:,}: {len(candidates)}")
    print(f"Excluded: {len(excluded)}")
    for e in excluded:
        print(f"  - {e['name']} ({e['geoid']}, pop {e['population']:,}): {e['reason']}")
    print(f"Eligible (all eight clues valid): {eligible}")
    print(f"Not on the featured list ({FEATURED.relative_to(ROOT)}): {len(not_featured)}")
    print(f"Resulting pool: {len(cities)} cities -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
