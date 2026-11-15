import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CitySearch from './components/CitySearch';
import MapView from './components/MapView';
import type { MapHandle, MissPin } from './components/MapView';
import { decodeChallenge, encodeChallenge } from './lib/challenge';
import { CITIES, CITY_BY_ID, META, cityLabel, cityLongLabel } from './lib/cities';
import { CLUES } from './lib/clues';
import { SCHEDULE, cityIdForPuzzle, nextResetMs, puzzleNumber } from './lib/daily';
import { KM_PER_MILE } from './lib/geo';
import { buildResult, isFinished, scoreGuesses } from './lib/round';
import {
  MAX_GUESSES,
  MAX_SCORE,
  TOTAL_CLUES,
  clueMultiplier,
  guessMultiplier,
  shareText,
} from './lib/scoring';
import type { RoundKind } from './lib/scoring';
import { loadDaily, loadStats, recordDaily, saveDaily, visitorId } from './lib/storage';
import { now } from './lib/time';
import type { City, GuessInput } from './lib/types';

type Mode = 'daily' | 'practice';
/** playing → guess (zooming to the guess) → answer (answer pin shown) → done */
type Stage = 'playing' | 'guess' | 'answer' | 'done';

interface Round {
  key: string;
  kind: RoundKind;
  puzzle: number | null;
  answerId: string;
  cluesRevealed: number;
  selectedId: string | null;
  guesses: GuessInput[];
  /** The round is over: exact guess, out of guesses, or the player stopped. */
  finished: boolean;
  stage: Stage;
}

const int = (n: number): string => Math.round(n).toLocaleString('en-US');

function dailyRound(puzzle: number): Round {
  const answerId = cityIdForPuzzle(puzzle, SCHEDULE, visitorId());
  const saved = loadDaily(puzzle, answerId);
  const answer = CITY_BY_ID.get(answerId)!;
  const guesses = saved?.guesses ?? [];
  const finished = isFinished(scoreGuesses(answer, guesses), saved?.finished ?? false);
  return {
    key: `daily-${puzzle}`,
    kind: 'daily',
    puzzle,
    answerId,
    cluesRevealed: saved?.cluesRevealed ?? 1,
    selectedId: null,
    guesses,
    finished,
    stage: finished ? 'done' : 'playing',
  };
}

let practiceCount = 0;
const recentPractice: string[] = [];
function practiceRound(challengeId: string | null = null): Round {
  let city: City;
  if (challengeId) {
    city = CITY_BY_ID.get(challengeId)!;
  } else {
    do city = CITIES[Math.floor(Math.random() * CITIES.length)];
    while (recentPractice.includes(city.id));
  }
  recentPractice.push(city.id);
  if (recentPractice.length > 25) recentPractice.shift();
  return {
    key: `practice-${++practiceCount}`,
    kind: challengeId ? 'challenge' : 'practice',
    puzzle: null,
    answerId: city.id,
    cluesRevealed: 1,
    selectedId: null,
    guesses: [],
    finished: false,
    stage: 'playing',
  };
}

/** City carried by a challenge link (?c=…), if the link is valid. Read once at start-up. */
const challengeFromLink = decodeChallenge(new URLSearchParams(window.location.search).get('c'));
if (challengeFromLink) {
  // Drop the code from the address bar so a refresh starts a normal game.
  window.history.replaceState(null, '', window.location.pathname);
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

  const [mode, setMode] = useState<Mode>(challengeFromLink ? 'practice' : 'daily');
  const [rounds, setRounds] = useState<Record<Mode, Round>>(() => ({
    daily: dailyRound(puzzleNumber(now())),
    practice: practiceRound(challengeFromLink),
  }));
  const [stats, setStats] = useState(loadStats);
  const [clock, setClock] = useState(() => now());
  const [copied, setCopied] = useState<'idle' | 'result' | 'link' | 'failed'>('idle');
  const [failedText, setFailedText] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);

  const round = rounds[mode];
  const answer = CITY_BY_ID.get(round.answerId)!;
  const selected = round.selectedId ? (CITY_BY_ID.get(round.selectedId) ?? null) : null;
  const scored = useMemo(() => scoreGuesses(answer, round.guesses), [answer, round.guesses]);
  const result = round.finished ? buildResult(scored, round.cluesRevealed) : null;
  const bestCity = result ? CITY_BY_ID.get(result.guessId)! : null;
  const playing = round.stage === 'playing';
  const resultVisible = round.stage === 'answer' || round.stage === 'done';
  const guessNumber = scored.length + 1;

  /** Patch a round only if it is still the one the caller was looking at. */
  const patchRound = useCallback((key: string, patch: Partial<Round>) => {
    setRounds((all) => {
      const m: Mode | null = all.daily.key === key ? 'daily' : all.practice.key === key ? 'practice' : null;
      return m ? { ...all, [m]: { ...all[m], ...patch } } : all;
    });
  }, []);

  // Persist the daily round: clue count and guesses while playing, then that it is finished.
  const daily = rounds.daily;
  useEffect(() => {
    saveDaily({
      puzzle: daily.puzzle!,
      answerId: daily.answerId,
      cluesRevealed: daily.cluesRevealed,
      guesses: daily.guesses,
      finished: daily.finished,
    });
  }, [daily.puzzle, daily.answerId, daily.cluesRevealed, daily.guesses, daily.finished]);

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
  const dailyUntouched =
    !daily.finished && daily.cluesRevealed === 1 && !daily.selectedId && daily.guesses.length === 0;
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
    setDetailsOpen(false);
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
      daily: all.daily.finished ? { ...all.daily, stage: 'done' } : all.daily,
      practice: all.practice.finished ? { ...all.practice, stage: 'done' } : all.practice,
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

  const missPin = (g: (typeof scored)[number]): MissPin => ({
    city: CITY_BY_ID.get(g.id)!,
    n: g.n,
    km: g.km,
    arrow: g.arrow,
  });

  /** End the round: play the reveal from the best guess to the answer. */
  const finish = (guesses: GuessInput[]) => {
    const all = scoreGuesses(answer, guesses);
    const final = buildResult(all, round.cluesRevealed);
    if (!final) return;
    // Every guess that is not the best one stays on the map as a numbered pin.
    for (const g of all) if (g.id !== final.guessId) mapRef.current?.addMiss(missPin(g), false);
    patchRound(round.key, { guesses, selectedId: null, finished: true, stage: 'guess' });
    if (round.kind === 'daily' && round.puzzle !== null) {
      setStats(recordDaily(round.puzzle, final.score));
    }
    mapRef.current?.reveal(CITY_BY_ID.get(final.guessId)!, answer);
  };

  const submitGuess = () => {
    if (!playing || !selected) return;
    const guesses = [...round.guesses, { id: selected.id, clues: round.cluesRevealed }];
    const all = scoreGuesses(answer, guesses);
    if (isFinished(all, false)) {
      finish(guesses);
    } else {
      patchRound(round.key, { guesses, selectedId: null });
      mapRef.current?.addMiss(missPin(all[all.length - 1]), true);
    }
  };

  const copy = async (what: 'result' | 'link') => {
    if (!result) return;
    const text =
      what === 'result'
        ? shareText(
            round.kind,
            round.puzzle,
            result.cluesUsed,
            result.guessesUsed,
            result.distanceKm,
            result.score,
          )
        : `I scored ${int(result.score)} on this CensusGuessr city. Can you beat it? ${
            window.location.origin
          }${window.location.pathname}?c=${encodeChallenge(round.answerId)}`;
    const ok = await copyText(text);
    setFailedText(text);
    setCopied(ok ? what : 'failed');
  };

  const maxNow = MAX_SCORE * clueMultiplier(round.cluesRevealed) * guessMultiplier(guessNumber);
  const exact = !!result && result.guessId === round.answerId;
  const roundKey = round.key;
  const lastMiss = playing && scored.length > 0 ? scored[scored.length - 1] : null;
  const title =
    round.kind === 'daily'
      ? `Daily Challenge #${round.puzzle}`
      : round.kind === 'challenge'
        ? 'Friend challenge'
        : 'Practice round';

  return (
    <div
      className={`app${detailsOpen ? ' details-open' : ''}`}
      data-stage={round.stage}
      data-reduced={reducedMotion ? '' : undefined}
    >
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
            initialMisses={scored.filter((g) => !g.exact && g.id !== result?.guessId).map(missPin)}
            initialFinal={bestCity ? { guess: bestCity, answer } : null}
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

        <section className="panel" aria-label="Clues and guess">
          <div className="panel-head">
            <div>
              <div className="eyebrow">{title}</div>
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
                {playing && <> · max {int(maxNow)}</>}
              </div>
            </div>
          </div>

          {!resultVisible && (
            <ol className="clues" aria-live="polite">
              {CLUES.slice(0, round.cluesRevealed).map((clue, i) => {
                const last = i === round.cluesRevealed - 1;
                return (
                  <li
                    key={clue.key}
                    ref={last ? lastClueRef : undefined}
                    className={last ? 'clue is-new' : 'clue'}
                  >
                    <div className="clue-label">
                      <span className="clue-num">{i + 1}</span>
                      {clue.label}
                    </div>
                    <div className="clue-value">
                      {clue.value(answer)}
                      {clue.unit && <small> {clue.unit}</small>}
                    </div>
                    {clue.rank && (
                      <div className="clue-note">
                        <b>{clue.rank(answer)}</b> · typical {clue.typical}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {resultVisible && bestCity && (
            <div className="compare-wrap">
              <table className="compare">
                <caption>{exact ? 'All eight clues' : 'How your guess compares'}</caption>
                <thead>
                  <tr>
                    <th scope="col">Clue</th>
                    {!exact && <th scope="col">{cityLabel(bestCity)}</th>}
                    <th scope="col">{cityLabel(answer)}</th>
                  </tr>
                </thead>
                <tbody>
                  {CLUES.map((clue, i) => (
                    <tr key={clue.key} className={i < round.cluesRevealed ? 'was-shown' : undefined}>
                      <th scope="row">{clue.label}</th>
                      {!exact && <td>{clue.value(bestCity)}</td>}
                      <td className="is-answer">{clue.value(answer)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="controls">
            {playing && (
              <>
                {scored.length > 0 && (
                  <ol className="misses" aria-label="Your guesses so far">
                    {scored.map((g) => (
                      <li key={g.n}>
                        <span className="miss-n">{g.n}</span>
                        <span className="miss-city">{cityLabel(CITY_BY_ID.get(g.id)!)}</span>
                        <span className="miss-km">{int(g.km)} km</span>
                        <span className="miss-dir" aria-label={`to the ${g.direction}`}>
                          {g.arrow} {g.direction}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                <CitySearch
                  key={`${roundKey}-${scored.length}`}
                  label={`Guess ${guessNumber} of ${MAX_GUESSES}`}
                  exclude={round.guesses.map((g) => g.id)}
                  selected={selected}
                  onSelect={selectCity}
                />
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
                        Reveal next clue <small>−10% max</small>
                      </>
                    )}
                  </button>
                  <button className="btn btn-primary" onClick={submitGuess} disabled={!selected}>
                    Submit guess
                  </button>
                </div>
                <p className="hint">
                  {selected ? (
                    `${cityLabel(selected)} is pinned on the map.`
                  ) : lastMiss ? (
                    <>
                      Not it. The city is <b>{int(lastMiss.km)} km</b> to the{' '}
                      <b>{lastMiss.direction}</b> of {cityLabel(CITY_BY_ID.get(lastMiss.id)!)}.
                    </>
                  ) : (
                    `Pick a city from the list, then submit. You get ${MAX_GUESSES} guesses.`
                  )}{' '}
                  {lastMiss && (
                    <button className="link" onClick={() => finish(round.guesses)}>
                      Stop and reveal the answer
                    </button>
                  )}
                </p>
              </>
            )}

            {round.stage === 'guess' && bestCity && (
              <div className="status" role="status">
                Locked in <b>{cityLabel(bestCity)}</b>. Revealing the actual city
              </div>
            )}

            {resultVisible && result && bestCity && (
              <div className="result" role="status">
                <div className="result-main">
                  <div>
                    <div className="eyebrow">{exact ? 'Exactly right — it was' : 'Actual city'}</div>
                    <div className="result-city">{cityLongLabel(answer)}</div>
                    {!exact && (
                      <div className="result-guess">
                        <span className="dot dot-guess" />
                        Your {result.guessesUsed > 1 ? 'best guess' : 'guess'}: {cityLabel(bestCity)}
                      </div>
                    )}
                  </div>
                  <dl className="stats">
                    <div>
                      <dt>Distance</dt>
                      <dd>
                        {int(result.distanceKm)} km
                        <small> {int(result.distanceKm / KM_PER_MILE)} mi</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Score</dt>
                      <dd>
                        {int(result.score)}
                        <small> / {int(MAX_SCORE)}</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Clues</dt>
                      <dd>
                        {result.cluesUsed}
                        <small> / {TOTAL_CLUES}</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Guesses</dt>
                      <dd>
                        {result.guessesUsed}
                        <small> / {MAX_GUESSES}</small>
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
                      <button className="btn only-mobile" onClick={() => setDetailsOpen((v) => !v)}>
                        {detailsOpen ? 'Hide compare' : 'Compare'}
                      </button>
                      <button className="btn" onClick={() => copy('result')}>
                        {copied === 'result' ? 'Copied!' : 'Copy result'}
                      </button>
                      <button className="btn" onClick={() => copy('link')}>
                        {copied === 'link' ? 'Link copied!' : 'Challenge a friend'}
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
                        Couldn’t reach the clipboard. Copy this instead: <code>{failedText}</code>
                      </p>
                    )}
                    {mode === 'daily' && (
                      <p className="hint">
                        Streak <b>{stats.streak}</b> · Played <b>{stats.played}</b> · Average{' '}
                        <b>{int(stats.played ? stats.total / stats.played : 0)}</b> · Best{' '}
                        <b>{int(stats.best)}</b>
                        {!dailyStale && (
                          <>
                            {' '}
                            · Next in <b className="tabular">{countdown(nextResetMs(clock) - clock)}</b>
                          </>
                        )}
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
          <li>
            Submit your guess. You get {MAX_GUESSES}. After a miss you see how far off you were and
            which way to go; each extra guess is worth 20% less.
          </li>
          <li>When the round ends, the map flies to the answer and you can compare the two cities.</li>
        </ol>
        <p>
          <b>Score</b> = 5,000 × e<sup>−distance ÷ 500 km</sup> × (1 − 0.10 × extra clues) × (1 −
          0.20 × extra guesses). Your best single guess counts, so another guess never costs you
          points. An exact first guess on the first clue earns 5,000.
        </p>
        <p>
          A new Daily Challenge starts at 00:00 UTC. The cities come in a different shuffled order
          for every player, so your city today is your own. Practice is unlimited, and{' '}
          <b>Challenge a friend</b> copies a link to the city you just played.
        </p>
        <p className="statline">
          <b>Your Daily stats</b> — Played {stats.played} · Streak {stats.streak} · Longest streak{' '}
          {stats.maxStreak} · Average {int(stats.played ? stats.total / stats.played : 0)} · Best{' '}
          {int(stats.best)}
        </p>
        <p className="fineprint">
          The game uses {META.count} of the largest and best-known U.S. cities. Clues are{' '}
          {META.acs.release} estimates from the U.S. Census Bureau; coordinates are from the{' '}
          {META.gazetteer.year} Census Gazetteer. Ranks compare a city with the other {META.count - 1}{' '}
          in the game. This product uses Census Bureau data but is not endorsed or certified by the
          Census Bureau.
        </p>
        <form method="dialog">
          <button className="btn btn-primary">Got it</button>
        </form>
      </dialog>
    </div>
  );
}
