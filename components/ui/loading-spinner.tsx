'use client';

import { useEffect, useState } from 'react';

export function LoadingSpinner({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-electric shadow-glow-cyan"></div>
    </div>
  );
}

const DEFAULT_STALE_MS = 12000;

export type FullPageLoadingVariant = 'default' | 'light';

export function FullPageLoading({
  message = 'Loading…',
  showStaleMessageAfterMs = DEFAULT_STALE_MS,
  variant = 'default',
  className = '',
}: {
  message?: string;
  showStaleMessageAfterMs?: number;
  variant?: FullPageLoadingVariant;
  className?: string;
}) {
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    if (showStaleMessageAfterMs <= 0) return;
    const t = setTimeout(() => setIsStale(true), showStaleMessageAfterMs);
    return () => clearTimeout(t);
  }, [showStaleMessageAfterMs]);

  const isLight = variant === 'light';
  const wrapperBg = isLight ? 'bg-gray-50' : '';
  const textClass = isLight ? 'text-gray-600' : 'text-gray-400';
  const spinnerBorder = isLight ? 'border-blue-600' : 'border-cyan-electric shadow-glow-cyan';

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center ${wrapperBg} ${className}`}>
      <div className="flex flex-col items-center justify-center gap-4">
        <div className={`animate-spin rounded-full h-12 w-12 border-b-2 ${spinnerBorder}`} />
        <p className={`text-sm ${textClass}`}>{message}</p>
        {isStale && (
          <div className={`mt-2 text-center max-w-xs ${textClass}`}>
            <p className="text-sm">This is taking longer than usual.</p>
            <p className="text-xs mt-1 mb-3">If nothing happens, try refreshing the page.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={
                isLight
                  ? 'px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700'
                  : 'px-4 py-2 text-sm font-medium rounded-lg bg-cyan-electric/20 text-cyan-electric hover:bg-cyan-electric/30'
              }
            >
              Refresh page
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function InlineSpinner({ className = '' }: { className?: string }) {
  return (
    <svg 
      className={`animate-spin h-5 w-5 text-cyan-electric ${className}`} 
      xmlns="http://www.w3.org/2000/svg" 
      fill="none" 
      viewBox="0 0 24 24"
    >
      <circle 
        className="opacity-25" 
        cx="12" 
        cy="12" 
        r="10" 
        stroke="currentColor" 
        strokeWidth="4"
      />
      <path 
        className="opacity-75" 
        fill="currentColor" 
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

