import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { cityLabel } from '../lib/cities';
import { haversineKm } from '../lib/geo';
import type { City } from '../lib/types';

// Tiles: OpenStreetMap's standard layer, which permits light use by small sites
// with visible attribution (https://operations.osmfoundation.org/policies/tiles/).
// Override both at build time for a higher-traffic deployment.
const TILE_URL = import.meta.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  import.meta.env.VITE_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

const US_BOUNDS: L.LatLngBoundsLiteral = [
  [24.3, -125],
  [49.6, -66.5],
];
const CITY_ZOOM = 10;
/** Beyond this distance the camera pulls back to show both cities before flying on. */
const PULL_BACK_KM = 150;

/** A wrong guess shown on the map with how far off it was and which way to go. */
export interface MissPin {
  city: City;
  n: number;
  km: number;
  arrow: string;
}

export interface MapHandle {
  /** Show (or clear) the preview pin for the currently selected suggestion. */
  preview(city: City | null): void;
  /** Mark a wrong guess. `move` brings it into view. */
  addMiss(miss: MissPin, move: boolean): void;
  /** Play the reveal: zoom to the guess, then fly to the answer, then frame both. */
  reveal(guess: City, answer: City): void;
  /** Jump straight to the end of the reveal. */
  skip(): void;
  viewAnswer(): void;
  showBoth(): void;
}

interface Props {
  initialPreview: City | null;
  /** Wrong guesses already made in this round (restored or revisited). */
  initialMisses: MissPin[];
  /** When set, the map mounts in its finished state (restored or revisited round). */
  initialFinal: { guess: City; answer: City } | null;
  reducedMotion: boolean;
  onAnswerShown: () => void;
  onRevealDone: () => void;
}

type PinKind = 'preview' | 'miss' | 'guess' | 'answer' | 'exact';

interface Token {
  cancelled: boolean;
  /** Ends the current wait or camera move early. */
  wake?: () => void;
  /** Restarts the current camera move toward its (recomputed) target. */
  redo?: () => void;
  /** Where the camera last settled, to re-centre if the container resizes between moves. */
  rest?: () => void;
}
const CANCELLED = Symbol('cancelled');

const at = (c: City): L.LatLngTuple => [c.lat, c.lon];

function pinIcon(kind: PinKind): L.DivIcon {
  return L.divIcon({
    className: `pin pin-${kind}`,
    html: '<span class="pin-dot"></span>',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** Label built with textContent, so no string is ever parsed as HTML. */
function pinLabel(title: string | null, text: string): HTMLElement {
  const el = document.createElement('div');
  if (title) {
    const strong = document.createElement('strong');
    strong.textContent = title;
    el.append(strong);
  }
  const span = document.createElement('span');
  span.textContent = text;
  el.append(span);
  return el;
}

const km = (n: number): string => `${Math.round(n).toLocaleString('en-US')} km`;

const MapView = forwardRef<MapHandle, Props>(function MapView(props, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tilesFailed, setTilesFailed] = useState(false);

  // Latest props for use inside long-lived Leaflet callbacks.
  const live = useRef(props);
  live.current = props;

  const api = useRef<MapHandle | null>(null);
  useImperativeHandle(ref, () => ({
    preview: (c) => api.current?.preview(c),
    addMiss: (m, move) => api.current?.addMiss(m, move),
    reveal: (g, a) => api.current?.reveal(g, a),
    skip: () => api.current?.skip(),
    viewAnswer: () => api.current?.viewAnswer(),
    showBoth: () => api.current?.showBoth(),
  }));

  useEffect(() => {
    const el = containerRef.current!;
    const map = L.map(el, {
      minZoom: 2, // low enough to frame Anchorage or Honolulu with an East Coast city on a phone
      maxZoom: 13,
      zoomSnap: 0.25,
      // Loose enough that framing two far-apart cities on a tall phone screen is never clamped.
      maxBounds: [
        [-60, -260],
        [85, 10],
      ],
      maxBoundsViscosity: 0.7,
    });

    // State outlines sit beneath the tiles: they show through while tiles load
    // and keep the map usable if the tile server is unreachable.
    // They load as a separate small file so they never delay the first screen.
    map.createPane('outline').style.zIndex = '150';
    let disposed = false;
    void import('../data/us-states.json').then((mod) => {
      if (disposed) return;
      const topo = mod.default as unknown as Topology;
      L.geoJSON(feature(topo, topo.objects.states as GeometryCollection), {
        pane: 'outline',
        interactive: false,
        style: { color: '#3a3a37', weight: 1, fillColor: '#121211', fillOpacity: 1 },
      }).addTo(map);
    });

    let tileErrors = 0;
    let tileLoads = 0;
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 })
      .on('tileload', () => {
        tileLoads++;
        if (tileLoads > tileErrors) setTilesFailed(false);
      })
      .on('tileerror', () => {
        tileErrors++;
        if (tileErrors >= 4 && tileErrors > tileLoads) setTilesFailed(true);
      })
      .addTo(map);

    const pins = L.layerGroup().addTo(map);
    let previewPin: L.Marker | null = null;
    let guessPin: L.Marker | null = null;
    let answerPin: L.Marker | null = null;
    let line: L.Polyline | null = null;
    let final: { guess: City; answer: City } | null = null;
    let token: Token | null = null;
    /** Which framing to restore when the container resizes; cleared once the player moves the map. */
    let autoFit: 'us' | 'both' | null = 'us';

    const reduced = () => live.current.reducedMotion;
    const fitPadding = (): L.FitBoundsOptions => {
      const size = map.getSize();
      const pad = Math.round(Math.min(90, Math.max(56, Math.min(size.x, size.y) * 0.18)));
      return { padding: [pad, pad], maxZoom: 11 }; // close enough to separate neighbouring cities
    };

    const fitUs = () => map.fitBounds(US_BOUNDS, { animate: false });
    fitUs();

    const addPin = (
      city: City,
      kind: PinKind,
      title: string | null,
      direction: 'top' | 'bottom',
      text: string = cityLabel(city),
    ) => {
      const marker = L.marker(at(city), {
        icon: pinIcon(kind),
        interactive: false,
        keyboard: false,
        zIndexOffset: kind === 'answer' ? 500 : 0,
      }).addTo(pins);
      marker.bindTooltip(pinLabel(title, text), {
        permanent: true,
        direction,
        offset: [0, direction === 'top' ? -14 : 14],
        className: `pin-label pin-label-${kind}`,
      });
      return marker;
    };

    const clearPreview = () => {
      previewPin?.remove();
      previewPin = null;
    };
    const missPins = new Map<string, L.Marker>();
    const showMiss = (miss: MissPin) => {
      clearPreview();
      if (missPins.has(miss.city.id)) return;
      const text = `${cityLabel(miss.city)} · ${km(miss.km)} ${miss.arrow}`;
      missPins.set(miss.city.id, addPin(miss.city, 'miss', `Guess ${miss.n}`, 'bottom', text));
    };
    const bringIntoView = (city: City) => {
      autoFit = null;
      const inView = map.getBounds().pad(-0.12).contains(at(city));
      if (inView && map.getZoom() >= 4.5) return;
      const zoom = Math.max(map.getZoom(), 5);
      if (reduced()) map.setView(at(city), zoom, { animate: false });
      else map.flyTo(at(city), zoom, { duration: 0.9 });
    };
    let guessIsExact = false;
    const ensureGuess = (guess: City, exact: boolean) => {
      clearPreview();
      // The guess that counts gets the main pin in place of its numbered one.
      missPins.get(guess.id)?.remove();
      missPins.delete(guess.id);
      if (guessPin && guessIsExact === exact) return;
      guessPin?.remove();
      guessIsExact = exact;
      guessPin = exact
        ? addPin(guess, 'exact', 'Your guess · Actual city', 'top')
        : addPin(guess, 'guess', 'Your guess', 'bottom');
    };
    const ensureAnswer = (answer: City) => {
      if (!answerPin) answerPin = addPin(answer, 'answer', 'Actual city', 'top');
    };
    const ensureLine = (guess: City, answer: City) => {
      if (line) return;
      line = L.polyline([at(guess), at(answer)], {
        color: '#ece8df',
        weight: 1.5,
        dashArray: '2 7',
        lineCap: 'round',
        interactive: false,
      }).addTo(pins);
    };

    const bothBounds = (guess: City, answer: City) => L.latLngBounds([at(guess), at(answer)]);

    /** Finished state: both pins, dashed line, both in view. */
    const showFinal = (guess: City, answer: City, animate: boolean) => {
      final = { guess, answer };
      const exact = guess.id === answer.id;
      ensureGuess(guess, exact);
      if (exact) {
        map.setView(at(answer), CITY_ZOOM, { animate });
      } else {
        ensureAnswer(answer);
        ensureLine(guess, answer);
        map.fitBounds(bothBounds(guess, answer), { ...fitPadding(), animate });
      }
      autoFit = 'both';
    };

    interface View {
      center: L.LatLng;
      zoom: number;
    }
    const cityView = (city: City): View => ({ center: L.latLng(at(city)), zoom: CITY_ZOOM });
    /** The view fitBounds would choose for both pins, computed for the container's current size. */
    const bothView = (guess: City, answer: City, maxZoom: number): View => {
      const bounds = bothBounds(guess, answer);
      const [pad] = fitPadding().padding as [number, number];
      const zoom = Math.min(maxZoom, map.getBoundsZoom(bounds, false, L.point(pad * 2, pad * 2)));
      const center = map.unproject(
        map
          .project(bounds.getSouthWest(), zoom)
          .add(map.project(bounds.getNorthEast(), zoom))
          .divideBy(2),
        zoom,
      );
      return { center, zoom };
    };
    const arrived = (view: View) =>
      Math.abs(map.getZoom() - view.zoom) < 0.01 &&
      map.latLngToContainerPoint(view.center).distanceTo(map.getSize().divideBy(2)) < 3;

    /**
     * Move the camera to a view; resolves on arrival (or when skipped). `target` is
     * re-evaluated if the container resizes mid-flight, which would otherwise cut
     * the animation short (on phones the panel changes height as the reveal starts).
     */
    const travel = (tok: Token, seconds: number, target: () => View) =>
      new Promise<void>((resolve, reject) => {
        if (tok.cancelled) return reject(CANCELLED);
        let view = target();
        let timer = 0;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          map.off('moveend', onMoveEnd);
          window.clearTimeout(timer);
          tok.wake = undefined;
          tok.redo = undefined;
          tok.rest = () => {
            const v = target();
            map.setView(v.center, v.zoom, { animate: false });
          };
          if (tok.cancelled) reject(CANCELLED);
          else resolve();
        };
        const onMoveEnd = () => {
          if (arrived(view)) finish();
        };
        const start = () => {
          view = target();
          window.clearTimeout(timer);
          if (reduced()) {
            map.setView(view.center, view.zoom, { animate: false });
            timer = window.setTimeout(finish, 60);
          } else {
            // Safety net: also moves the reveal along if the player grabs the map mid-flight.
            timer = window.setTimeout(finish, seconds * 1000 + 600);
            map.flyTo(view.center, view.zoom, { duration: seconds });
          }
        };
        tok.wake = finish;
        tok.redo = start;
        start();
        map.on('moveend', onMoveEnd);
      });

    const pause = (tok: Token, ms: number) =>
      new Promise<void>((resolve, reject) => {
        if (tok.cancelled) return reject(CANCELLED);
        const finish = () => {
          window.clearTimeout(timer);
          tok.wake = undefined;
          if (tok.cancelled) reject(CANCELLED);
          else resolve();
        };
        tok.wake = finish;
        const timer = window.setTimeout(finish, ms);
      });

    const flyTo = (tok: Token, city: City, seconds: number) =>
      travel(tok, seconds, () => cityView(city));
    const flyToBoth = (tok: Token, guess: City, answer: City, seconds: number, maxZoom: number) =>
      travel(tok, seconds, () => bothView(guess, answer, maxZoom));

    const playReveal = async (guess: City, answer: City, tok: Token) => {
      const exact = guess.id === answer.id;
      autoFit = null;
      ensureGuess(guess, false);

      // Let the layout settle first (the panel resizes once the guess is locked in).
      await pause(tok, 150);

      // 1. Zoom into the guess. An exact guess ends here: the one pin becomes the answer pin.
      await flyTo(tok, guess, 1.8);
      if (exact) {
        await pause(tok, 500);
        ensureGuess(guess, true);
        live.current.onAnswerShown();
        return;
      }
      await pause(tok, 900);

      // 2. For a distant guess, pull back first so the trip to the answer reads clearly.
      if (haversineKm(guess.lat, guess.lon, answer.lat, answer.lon) > PULL_BACK_KM) {
        await flyToBoth(tok, guess, answer, 1.4, 7);
        await pause(tok, 450);
      }

      // 3. Fly to the answer and drop its pin.
      await flyTo(tok, answer, 2.2);
      ensureAnswer(answer);
      live.current.onAnswerShown();
      await pause(tok, 1700);

      // 4. Frame both pins with the dashed line between them.
      ensureLine(guess, answer);
      await flyToBoth(tok, guess, answer, 1.3, 11);
    };

    api.current = {
      preview(city) {
        if (final || token) return;
        clearPreview();
        if (!city) return;
        previewPin = addPin(city, 'preview', null, 'top');
        bringIntoView(city);
      },
      addMiss(miss, move) {
        if (final || token) return;
        showMiss(miss);
        if (move) bringIntoView(miss.city);
      },
      reveal(guess, answer) {
        if (token) return;
        const tok: Token = { cancelled: false };
        token = tok;
        final = { guess, answer };
        playReveal(guess, answer, tok)
          .then(() => {
            token = null;
            autoFit = 'both';
            live.current.onRevealDone();
          })
          .catch((err) => {
            if (err !== CANCELLED) throw err;
          });
      },
      skip() {
        if (!token || !final) return;
        token.cancelled = true;
        token.wake?.();
        token = null;
        map.stop();
        showFinal(final.guess, final.answer, false);
        live.current.onAnswerShown();
        live.current.onRevealDone();
      },
      viewAnswer() {
        if (!final || token) return;
        autoFit = null;
        const target = at(final.answer);
        if (reduced()) map.setView(target, CITY_ZOOM, { animate: false });
        else map.flyTo(target, CITY_ZOOM, { duration: 1.6 });
      },
      showBoth() {
        if (!final || token) return;
        autoFit = 'both';
        const { guess, answer } = final;
        if (guess.id === answer.id) {
          map.setView(at(answer), CITY_ZOOM, { animate: !reduced() });
          return;
        }
        const bounds = bothBounds(guess, answer);
        if (reduced()) map.fitBounds(bounds, { ...fitPadding(), animate: false });
        else map.flyToBounds(bounds, { ...fitPadding(), duration: 1.2 });
      },
    };

    const { initialFinal, initialPreview, initialMisses } = live.current;
    initialMisses.forEach(showMiss);
    if (initialFinal) showFinal(initialFinal.guess, initialFinal.answer, false);
    else if (initialPreview) api.current.preview(initialPreview);

    // Once the player moves the map themselves, stop re-framing it on resize.
    const userMoved = () => {
      if (!token) autoFit = null;
    };
    el.addEventListener('pointerdown', userMoved);
    el.addEventListener('wheel', userMoved, { passive: true });
    el.addEventListener('keydown', userMoved);

    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false, pan: false });
      if (token) {
        if (token.redo) token.redo();
        else token.rest?.();
        return;
      }
      if (autoFit === 'us') fitUs();
      else if (autoFit === 'both' && final) showFinal(final.guess, final.answer, false);
    });
    observer.observe(el);

    return () => {
      disposed = true;
      observer.disconnect();
      if (token) token.cancelled = true;
      token?.wake?.();
      token = null;
      api.current = null;
      map.remove();
    };
  }, []);

  return (
    <div className="map-shell">
      <div ref={containerRef} className="map" aria-label="Map of the United States" />
      {tilesFailed && (
        <div className="map-note" role="status">
          Map tiles are unavailable — showing state outlines only.
        </div>
      )}
    </div>
  );
});

export default MapView;
