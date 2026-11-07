'use client';

import * as React from 'react';

export interface CityEntry {
  city: string;
  state_id: string;
  state_name: string;
  lat: number;
  lng: number;
  population: number;
}

export interface CityAutocompleteProps {
  value: string;
  onChange: (value: string, entry?: CityEntry) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

type CitiesData = CityEntry[];

let citiesPromise: Promise<CitiesData> | null = null;
let citiesCache: CitiesData | null = null;

function loadCities(): Promise<CitiesData> {
  if (citiesCache) return Promise.resolve(citiesCache);
  if (!citiesPromise) {
    citiesPromise = import('@/lib/data/us-cities.json').then((mod) => {
      citiesCache = mod.default as CitiesData;
      return citiesCache;
    });
  }
  return citiesPromise;
}

function formatCity(entry: CityEntry): string {
  return `${entry.city}, ${entry.state_id}`;
}

function searchCities(cities: CitiesData, query: string, limit = 10): CityEntry[] {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase().trim();

  const parts = q.split(',').map((p) => p.trim());
  const cityQuery = parts[0];
  const stateQuery = parts[1] || '';

  const results: CityEntry[] = [];
  for (const entry of cities) {
    if (results.length >= limit) break;

    const cityLower = entry.city.toLowerCase();
    const stateIdLower = entry.state_id.toLowerCase();
    const stateNameLower = entry.state_name.toLowerCase();

    if (!cityLower.startsWith(cityQuery) && !cityLower.includes(cityQuery)) continue;

    if (stateQuery) {
      if (
        !stateIdLower.startsWith(stateQuery) &&
        !stateNameLower.startsWith(stateQuery)
      ) {
        continue;
      }
    }

    results.push(entry);
  }

  return results;
}

const CityAutocomplete = React.forwardRef<HTMLInputElement, CityAutocompleteProps>(
  ({ value, onChange, placeholder = 'e.g., Grand Blanc, MI', className = '', disabled }, ref) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const [results, setResults] = React.useState<CityEntry[]>([]);
    const [highlightIndex, setHighlightIndex] = React.useState(-1);
    const [cities, setCities] = React.useState<CitiesData | null>(null);
    const wrapperRef = React.useRef<HTMLDivElement>(null);
    const debounceRef = React.useRef<NodeJS.Timeout | null>(null);

    React.useEffect(() => {
      loadCities().then(setCities);
    }, []);

    React.useEffect(() => {
      function handleClickOutside(e: MouseEvent) {
        if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
          setIsOpen(false);
        }
      }
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      onChange(val);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (!cities || val.length < 2) {
          setResults([]);
          setIsOpen(false);
          return;
        }
        const found = searchCities(cities, val);
        setResults(found);
        setHighlightIndex(-1);
        setIsOpen(found.length > 0);
      }, 150);
    };

    const handleSelect = (entry: CityEntry) => {
      const formatted = formatCity(entry);
      onChange(formatted, entry);
      setIsOpen(false);
      setResults([]);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen || results.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < results.length) {
          handleSelect(results[highlightIndex]);
        }
      } else if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    const handleFocus = () => {
      if (results.length > 0 && value.length >= 2) {
        setIsOpen(true);
      }
    };

    return (
      <div ref={wrapperRef} className="relative">
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          placeholder={placeholder}
          disabled={disabled}
          className={`flex h-10 w-full rounded-lg border border-white/10 bg-navy-dark/70 backdrop-blur-sm px-3 py-2 text-sm text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-electric focus:border-cyan-electric focus:shadow-glow-cyan transition-all disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          autoComplete="off"
        />
        {isOpen && results.length > 0 && (
          <ul
            className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-white/10 bg-navy-dark/95 backdrop-blur-md shadow-lg"
            role="listbox"
          >
            {results.map((entry, idx) => (
              <li
                key={`${entry.city}-${entry.state_id}-${idx}`}
                role="option"
                aria-selected={idx === highlightIndex}
                className={`cursor-pointer px-3 py-2 text-sm transition-colors ${
                  idx === highlightIndex
                    ? 'bg-cyan-electric/20 text-white'
                    : 'text-gray-300 hover:bg-white/5 hover:text-white'
                }`}
                onMouseEnter={() => setHighlightIndex(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(entry);
                }}
              >
                <span className="font-medium">{entry.city}</span>
                <span className="text-gray-400">, {entry.state_id}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
);

CityAutocomplete.displayName = 'CityAutocomplete';

export { CityAutocomplete, formatCity };
