import { useCallback, useEffect, useRef, useState } from 'react';
import CitySearch from './components/CitySearch';
import MapView from './components/MapView';
import type { MapHandle } from './components/MapView';
import { CITIES, CITY_BY_ID, META, cityLabel, cityLongLabel } from './lib/cities';
import { CLUES } from './lib/clues';
import { cityIdForPuzzle, nextResetMs, puzzleNumber } from './lib/daily';
import { KM_PER_MILE, haversineKm } from './lib/geo';
import { MAX_SCORE, TOTAL_CLUES, clueMultiplier, scoreGuess, shareText } from './lib/scoring';
import { loadDaily, saveDaily } from './lib/storage';
import { now } from './lib/time';
import type { City, Result } from './lib/types';

type Mode = 'daily' | 'practice';
/** playing → guess (zooming to the guess) → answer (answer pin shown) → done */
type Stage = 'playing' | 'guess' | 'answer' | 'done';

interface Round {
  key: string;
  puzzle: number | null;
  answerId: string;
  cluesRevealed: number;
  selectedId: string | null;
  result: Result | null;
  stage: Stage;
}

const int = (n: number): string => Math.round(n).toLocaleString('en-US');

function dailyRound(puzzle: number): Round {
  const answerId = cityIdForPuzzle(puzzle);
  const saved = loadDaily(puzzle, answerId);
  return {
    key: `daily-${puzzle}`,
    puzzle,
    answerId,
    cluesRevealed: saved?.cluesRevealed ?? 1,
    selectedId: null,
    result: saved?.result ?? null,
    stage: saved?.result ? 'done' : 'playing',
  };
}

let practiceCount = 0;
const recentPractice: string[] = [];
function practiceRound(): Round {
  let city: City;
  do city = CITIES[Math.floor(Math.random() * CITIES.length)];
  while (recentPractice.includes(city.id));
  recentPractice.push(city.id);
  if (recentPractice.length > 40) recentPractice.shift();
  return {
    key: `practice-${++practiceCount}`,
    puzzle: null,
    answerId: city.id,
    cluesRevealed: 1,
    selectedId: null,
    result: null,
    stage: 'playing',
  };
}

function useReducedMotion(): boolean {
  // `?reducedMotion=1` forces it on, for players (and tests) without an OS-level setting.
  const forced = new URLSearchParams(window.location.search).get('reducedMotion') === '1';
  const [reduced, setReduced] = useState(
    () => forced || window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (forced) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [forced]);
  return reduced;
}

function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const part = (n: number) => String(n).padStart(2, '0');
  return `${part(Math.floor(s / 3600))}:${part(Math.floor((s % 3600) / 60))}:${part(s % 60)}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export default function App() {
  const reducedMotion = useReducedMotion();
  const mapRef = useRef<MapHandle>(null);
  const helpRef = useRef<HTMLDialogElement>(null);
  const lastClueRef = useRef<HTMLLIElement>(null);

  const [mode, setMode] = useState<Mode>('daily');
  const [rounds, setRounds] = useState<Record<Mode, Round>>(() => ({
    daily: dailyRound(puzzleNumber(now())),
    practice: practiceRound(),
  }));
  const [clock, setClock] = useState(() => now());
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const [cluesOpen, setCluesOpen] = useState(false);

  const round = rounds[mode];
  const answer = CITY_BY_ID.get(round.answerId)!;
  const selected = round.selectedId ? CITY_BY_ID.get(round.selectedId) ?? null : null;
  const guess = round.result ? CITY_BY_ID.get(round.result.guessId)! : null;
  const playing = round.stage === 'playing';
  const resultVisible = round.stage === 'answer' || round.stage === 'done';

  /** Patch a round only if it is still the one the caller was looking at. */
  const patchRound = useCallback((key: string, patch: Partial<Round>) => {
    setRounds((all) => {
      const m: Mode | null = all.daily.key === key ? 'daily' : all.practice.key === key ? 'practice' : null;
      return m ? { ...all, [m]: { ...all[m], ...patch } } : all;
    });
  }, []);

  // Persist the daily round: clue count while playing, then the result.
  const daily = rounds.daily;
  useEffect(() => {
    saveDaily({
      puzzle: daily.puzzle!,
      answerId: daily.answerId,
      cluesRevealed: daily.cluesRevealed,
      result: daily.result,
    });
  }, [daily.puzzle, daily.answerId, daily.cluesRevealed, daily.result]);

  // Clock: drives the countdown and detects the 00:00 UTC rollover.
  useEffect(() => {
    const tick = () => setClock(now());
    const timer = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, []);

  const todayPuzzle = puzzleNumber(clock);
  const dailyStale = daily.puzzle !== todayPuzzle;
  const dailyUntouched = !daily.result && daily.cluesRevealed === 1 && !daily.selectedId;
  const loadToday = useCallback(() => {
    setRounds((all) => ({ ...all, daily: dailyRound(puzzleNumber(now())) }));
  }, []);
  // An untouched puzzle rolls over silently; one in progress or finished waits for the player.
  useEffect(() => {
    if (dailyStale && dailyUntouched) loadToday();
  }, [dailyStale, dailyUntouched, loadToday]);

  // Keep the newest clue in view.
  useEffect(() => {
    lastClueRef.current?.scrollIntoView({
      block: 'nearest',
      inline: 'center',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  }, [round.key, round.cluesRevealed, reducedMotion]);

  useEffect(() => {
    setCopied('idle');
    setCluesOpen(false);
  }, [round.key, mode]);

  // Esc skips the reveal animation.
  const revealing = round.stage === 'guess' || round.stage === 'answer';
  useEffect(() => {
    if (!revealing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') mapRef.current?.skip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealing]);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    // The map remounts per round, so a reveal left mid-flight resumes in its finished state.
    setRounds((all) => ({
      daily: all.daily.result ? { ...all.daily, stage: 'done' } : all.daily,
      practice: all.practice.result ? { ...all.practice, stage: 'done' } : all.practice,
    }));
    setMode(next);
  };

  const selectCity = (city: City | null) => {
    patchRound(round.key, { selectedId: city?.id ?? null });
    mapRef.current?.preview(city);
  };

  const revealClue = () => {
    if (playing && round.cluesRevealed < TOTAL_CLUES) {
      patchRound(round.key, { cluesRevealed: round.cluesRevealed + 1 });
    }
  };

  const submitGuess = () => {
    if (!playing || !selected) return;
    const distanceKm =
      selected.id === answer.id ? 0 : haversineKm(selected.lat, selected.lon, answer.lat, answer.lon);
    const result: Result = {
      guessId: selected.id,
      distanceKm,
      score: scoreGuess(distanceKm, round.cluesRevealed),
      cluesUsed: round.cluesRevealed,
    };
    patchRound(round.key, { result, stage: 'guess' });
    mapRef.current?.reveal(selected, answer);
  };

  const share = async () => {
    if (!round.result) return;
    const { cluesUsed, distanceKm, score } = round.result;
    const ok = await copyText(shareText(round.puzzle, cluesUsed, distanceKm, score));
    setCopied(ok ? 'ok' : 'failed');
  };

  const multiplier = clueMultiplier(round.cluesRevealed);
  const exact = !!round.result && round.result.guessId === round.answerId;
  const roundKey = round.key;

  return (
    <div className="app" data-stage={round.stage} data-reduced={reducedMotion ? '' : undefined}>
      <header className="topbar">
        <h1 className="brand">
          Census<em>Guessr</em>
        </h1>
        <div className="tabs" role="tablist" aria-label="Game mode">
          <button
            role="tab"
            aria-selected={mode === 'daily'}
            className="tab"
            onClick={() => switchMode('daily')}
          >
            Daily <span className="tab-num">#{daily.puzzle}</span>
          </button>
          <button
            role="tab"
            aria-selected={mode === 'practice'}
            className="tab"
            onClick={() => switchMode('practice')}
          >
            Practice
          </button>
        </div>
        <button className="icon-btn" aria-label="How to play" onClick={() => helpRef.current?.showModal()}>
          ?
        </button>
      </header>

      {mode === 'daily' && dailyStale && !dailyUntouched && (
        <div className="banner" role="status">
          <span>Daily Challenge #{todayPuzzle} is ready.</span>
          <button className="btn btn-small" onClick={loadToday}>
            Play #{todayPuzzle}
          </button>
        </div>
      )}

      <main className="layout">
        <section className="map-wrap" aria-label="Map">
          <MapView
            key={roundKey}
            ref={mapRef}
            initialPreview={selected}
            initialFinal={guess ? { guess, answer } : null}
            reducedMotion={reducedMotion}
            onAnswerShown={() => patchRound(roundKey, { stage: 'answer' })}
            onRevealDone={() => patchRound(roundKey, { stage: 'done' })}
          />
          {revealing && (
            <button className="skip" onClick={() => mapRef.current?.skip()}>
              Skip animation
            </button>
          )}
        </section>

        <section className={`panel${cluesOpen ? ' clues-open' : ''}`} aria-label="Clues and guess">
          <div className="panel-head">
            <div>
              <div className="eyebrow">
                {mode === 'daily' ? `Daily Challenge #${round.puzzle}` : 'Practice round'}
              </div>
              <h2 className="panel-title">
                Which U.S. city <em>is this?</em>
              </h2>
            </div>
            <div className="meter" aria-label={`Clue ${round.cluesRevealed} of ${TOTAL_CLUES}`}>
              <div className="meter-dots" aria-hidden="true">
                {CLUES.map((c, i) => (
                  <i key={c.key} className={i < round.cluesRevealed ? 'on' : undefined} />
                ))}
              </div>
              <div className="meter-text">
                Clue {round.cluesRevealed}/{TOTAL_CLUES}
                {playing && <> · max {int(MAX_SCORE * multiplier)}</>}
              </div>
            </div>
          </div>

          <ol className="clues" aria-live="polite">
            {CLUES.slice(0, round.cluesRevealed).map((clue, i) => {
              const last = i === round.cluesRevealed - 1;
              return (
                <li key={clue.key} ref={last ? lastClueRef : undefined} className={last ? 'clue is-new' : 'clue'}>
                  <div className="clue-label">
                    <span className="clue-num">{i + 1}</span>
                    {clue.label}
                  </div>
                  <div className="clue-value">
                    {clue.value(answer)}
                    {clue.unit && <small> {clue.unit}</small>}
                  </div>
                  {clue.typical && <div className="clue-note">Typical city in the game: {clue.typical}</div>}
                </li>
              );
            })}
          </ol>

          <div className="controls">
            {playing && (
              <>
                <CitySearch key={roundKey} selected={selected} onSelect={selectCity} />
                <div className="actions">
                  <button
                    className="btn"
                    onClick={revealClue}
                    disabled={round.cluesRevealed >= TOTAL_CLUES}
                  >
                    {round.cluesRevealed >= TOTAL_CLUES ? (
                      'All clues revealed'
                    ) : (
                      <>
                        Reveal next clue <small>−{int(MAX_SCORE * 0.1)} max</small>
                      </>
                    )}
                  </button>
                  <button className="btn btn-primary" onClick={submitGuess} disabled={!selected}>
                    Submit guess
                  </button>
                </div>
                <p className="hint">
                  {selected
                    ? `${cityLabel(selected)} is pinned on the map. You get one guess.`
                    : 'Pick a city from the list, then submit. You get one guess.'}
                </p>
              </>
            )}

            {round.stage === 'guess' && guess && (
              <div className="status" role="status">
                <span className="dot dot-guess" /> Locked in <b>{cityLabel(guess)}</b>. Revealing the
                actual city…
              </div>
            )}

            {resultVisible && round.result && guess && (
              <div className="result" role="status">
                <div className="result-main">
                  <div>
                    <div className="eyebrow">{exact ? 'Exactly right — it was' : 'Actual city'}</div>
                    <div className="result-city">{cityLongLabel(answer)}</div>
                    {!exact && (
                      <div className="result-guess">
                        <span className="dot dot-guess" /> Your guess: {cityLabel(guess)}
                      </div>
                    )}
                  </div>
                  <dl className="stats">
                    <div>
                      <dt>Distance</dt>
                      <dd>
                        {int(round.result.distanceKm)} km
                        <small> {int(round.result.distanceKm / KM_PER_MILE)} mi</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Score</dt>
                      <dd>
                        {int(round.result.score)}
                        <small> / {int(MAX_SCORE)}</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Clues</dt>
                      <dd>
                        {round.result.cluesUsed}
                        <small> / {TOTAL_CLUES}</small>
                      </dd>
                    </div>
                  </dl>
                </div>

                {round.stage === 'done' && (
                  <>
                    <div className="actions actions-wrap">
                      <button className="btn" onClick={() => mapRef.current?.viewAnswer()}>
                        View answer
                      </button>
                      {!exact && (
                        <button className="btn" onClick={() => mapRef.current?.showBoth()}>
                          Show both
                        </button>
                      )}
                      <button className="btn" onClick={share}>
                        {copied === 'ok' ? 'Copied!' : 'Copy result'}
                      </button>
                      <button className="btn only-mobile" onClick={() => setCluesOpen((v) => !v)}>
                        {cluesOpen ? 'Hide clues' : 'Clues'}
                      </button>
                      {mode === 'practice' ? (
                        <button
                          className="btn btn-primary"
                          onClick={() => setRounds((all) => ({ ...all, practice: practiceRound() }))}
                        >
                          Next round
                        </button>
                      ) : (
                        <button className="btn btn-primary" onClick={() => switchMode('practice')}>
                          Play Practice
                        </button>
                      )}
                    </div>
                    {copied === 'failed' && (
                      <p className="hint">
                        Couldn’t reach the clipboard. Copy this instead:{' '}
                        <code>
                          {shareText(
                            round.puzzle,
                            round.result.cluesUsed,
                            round.result.distanceKm,
                            round.result.score,
                          )}
                        </code>
                      </p>
                    )}
                    {mode === 'daily' && !dailyStale && (
                      <p className="hint">
                        Next Daily Challenge in{' '}
                        <b className="tabular">{countdown(nextResetMs(clock) - clock)}</b> (resets 00:00
                        UTC).
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      </main>

      <dialog ref={helpRef} className="help" aria-labelledby="help-title">
        <h2 id="help-title">How to play</h2>
        <ol>
          <li>Read the clue. Every clue is a real Census statistic about one famous U.S. city.</li>
          <li>
            Search for a city and pick it from the list to pin it on the map, or reveal another clue.
            Each extra clue lowers the maximum score by 10%.
          </li>
          <li>Submit when you’re ready. You get one guess, then the map flies to the answer.</li>
        </ol>
        <p>
          <b>Score</b> = 5,000 × e<sup>−distance ÷ 500 km</sup> × (1 − 0.10 × extra clues). An exact
          guess on the first clue earns 5,000.
        </p>
        <p>
          The Daily Challenge is the same city for everyone and resets at 00:00 UTC. Practice is
          unlimited.
        </p>
        <p className="fineprint">
          The game uses {META.count} of the largest and best-known U.S. cities. Clues are{' '}
          {META.acs.release} estimates from the U.S. Census Bureau; coordinates are from the{' '}
          {META.gazetteer.year} Census Gazetteer. “Most common ancestry” is the largest single
          ancestry group people reported, and excludes the Census’s combined “Other groups” category.
          This product uses Census Bureau data but is not endorsed or certified by the Census Bureau.
        </p>
        <form method="dialog">
          <button className="btn btn-primary">Got it</button>
        </form>
      </dialog>
    </div>
  );
}
