'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Search, X, ChevronDown, Plus } from 'lucide-react';
import { SERVICES_LIST } from '@/lib/services-list';

interface ServiceSelectorProps {
  selected: string[];
  onChange: (selected: string[]) => void;
  maxSelections?: number;
  excludeServices?: string[];
}

export function ServiceSelector({ selected, onChange, maxSelections, excludeServices = [] }: ServiceSelectorProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const excluded = new Set([...selected, ...excludeServices]);
    const q = query.toLowerCase().trim();
    if (!q) return SERVICES_LIST.filter((s) => !excluded.has(s));
    return SERVICES_LIST.filter(
      (s) => s.toLowerCase().includes(q) && !excluded.has(s)
    );
  }, [query, selected, excludeServices]);

  const canAddCustom = useMemo(() => {
    const q = query.trim();
    if (!q) return false;
    const alreadySelected = selected.some(s => s.toLowerCase() === q.toLowerCase());
    const alreadyExcluded = excludeServices.some(s => s.toLowerCase() === q.toLowerCase());
    const exactMatch = filtered.some(s => s.toLowerCase() === q.toLowerCase());
    return !alreadySelected && !alreadyExcluded && !exactMatch;
  }, [query, selected, excludeServices, filtered]);

  const totalItems = filtered.length + (canAddCustom ? 1 : 0);

  // Reset highlighted index when filtered list changes
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filtered.length, query]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current || !isOpen) return;
    const item = listRef.current.children[highlightedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, isOpen]);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addService = useCallback(
    (service: string) => {
      if (maxSelections && selected.length >= maxSelections) return;
      onChange([...selected, service]);
      setQuery('');
      inputRef.current?.focus();
    },
    [selected, onChange, maxSelections]
  );

  const removeService = useCallback(
    (service: string) => {
      onChange(selected.filter((s) => s !== service));
    },
    [selected, onChange]
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen && e.key !== 'Escape') {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
        e.preventDefault();
        return;
      }
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => Math.min(prev + 1, totalItems - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[highlightedIndex]) {
          addService(filtered[highlightedIndex]);
        } else if (canAddCustom && highlightedIndex === filtered.length) {
          addService(query.trim());
        }
        break;
      case 'Escape':
        setIsOpen(false);
        inputRef.current?.blur();
        break;
      case 'Backspace':
        if (query === '' && selected.length > 0) {
          removeService(selected[selected.length - 1]);
        }
        break;
    }
  }

  const atLimit = maxSelections !== undefined && selected.length >= maxSelections;

  return (
    <div ref={containerRef} className="relative">
      {/* Selected tags */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selected.map((service) => (
            <span
              key={service}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm bg-cyan-electric/15 text-cyan-electric border border-cyan-electric/30"
            >
              {service}
              <button
                type="button"
                onClick={() => removeService(service)}
                className="ml-0.5 hover:text-white transition-colors"
                aria-label={`Remove ${service}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={atLimit ? `Maximum ${maxSelections} services selected` : 'Search services...'}
          disabled={atLimit}
          className="w-full pl-10 pr-10 py-3 border border-white/10 bg-navy-dark/70 backdrop-blur-sm rounded-lg focus:ring-2 focus:ring-cyan-electric focus:border-cyan-electric focus:shadow-glow-cyan outline-none transition text-white placeholder:text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <ChevronDown
          className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </div>

      {/* Dropdown */}
      {isOpen && !atLimit && (
        <ul
          ref={listRef}
          className="absolute z-50 w-full mt-1 max-h-60 overflow-y-auto rounded-lg border border-white/10 bg-navy-dark/95 backdrop-blur-md shadow-glass"
          role="listbox"
        >
          {filtered.length === 0 && !canAddCustom ? (
            <li className="px-4 py-3 text-sm text-gray-400">
              {query ? 'No services found' : 'All services selected'}
            </li>
          ) : (
            <>
              {filtered.map((service, index) => (
                <li
                  key={service}
                  role="option"
                  aria-selected={index === highlightedIndex}
                  className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${
                    index === highlightedIndex
                      ? 'bg-cyan-electric/15 text-cyan-electric'
                      : 'text-gray-300 hover:bg-white/5 hover:text-white'
                  }`}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addService(service);
                  }}
                >
                  {service}
                </li>
              ))}
              {canAddCustom && (
                <li
                  key="__custom__"
                  role="option"
                  aria-selected={highlightedIndex === filtered.length}
                  className={`px-4 py-2.5 text-sm cursor-pointer transition-colors flex items-center gap-2 ${
                    filtered.length > 0 ? 'border-t border-white/10' : ''
                  } ${
                    highlightedIndex === filtered.length
                      ? 'bg-cyan-electric/15 text-cyan-electric'
                      : 'text-cyan-electric/70 hover:bg-cyan-electric/10 hover:text-cyan-electric'
                  }`}
                  onMouseEnter={() => setHighlightedIndex(filtered.length)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addService(query.trim());
                  }}
                >
                  <Plus className="w-4 h-4 flex-shrink-0" />
                  Add &ldquo;{query.trim()}&rdquo; as custom service
                </li>
              )}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
