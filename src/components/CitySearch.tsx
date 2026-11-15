import { useId, useMemo, useRef, useState } from 'react';
import { CITIES, cityLabel } from '../lib/cities';
import { buildIndex, searchCities } from '../lib/search';
import type { City } from '../lib/types';

interface Props {
  /** Field label, e.g. "Guess 2 of 3". */
  label: string;
  /** City ids already guessed this round; left out of the suggestions. */
  exclude: string[];
  selected: City | null;
  onSelect: (city: City | null) => void;
}

const INDEX = buildIndex(CITIES);

/** Autocomplete combobox. Picking a suggestion selects it; editing the text clears the selection. */
export default function CitySearch({ label, exclude, selected, onSelect }: Props) {
  const [query, setQuery] = useState(selected ? cityLabel(selected) : '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const matches = useMemo(
    () =>
      selected
        ? []
        : searchCities(INDEX, query, 8 + exclude.length)
            .filter((c) => !exclude.includes(c.id))
            .slice(0, 8),
    [query, selected, exclude],
  );
  const showList = open && !selected && query.trim() !== '';

  const choose = (city: City) => {
    setQuery(cityLabel(city));
    setOpen(false);
    onSelect(city);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!matches.length) return;
      e.preventDefault();
      setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + matches.length) % matches.length);
    } else if (e.key === 'Enter') {
      if (showList && matches[active]) {
        e.preventDefault();
        choose(matches[active]);
      }
    } else if (e.key === 'Escape' && showList) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="search">
      <label className="search-label" htmlFor={`${listId}-input`}>
        {label}
      </label>
      <div className="search-box">
        <input
          id={`${listId}-input`}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && matches[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="Search for a city…"
          value={query}
          className={selected ? 'has-selection' : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
            if (selected) onSelect(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {query !== '' && (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear guess"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery('');
              if (selected) onSelect(null);
              inputRef.current?.focus();
            }}
          >
            ×
          </button>
        )}
        {showList && (
          <ul id={listId} role="listbox" className="search-list" aria-label="Matching cities">
            {matches.length === 0 && (
              <li className="search-empty" role="presentation">
                No city in the game matches “{query.trim()}”.
              </li>
            )}
            {matches.map((city, i) => (
              <li
                key={city.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'is-active' : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(city)}
              >
                <span className="search-city">
                  {city.name}, <b>{city.state}</b>
                </span>
                <span className="search-state">{city.stateName}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
