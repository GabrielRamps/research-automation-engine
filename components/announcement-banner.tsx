'use client';

import { useState, useEffect } from 'react';

interface AnnouncementBannerProps {
  message: string;
  enabled: boolean;
}

export default function AnnouncementBanner({ message, enabled }: AnnouncementBannerProps) {
  const [dismissed, setDismissed] = useState(true); // start hidden to avoid flash

  useEffect(() => {
    const dismissedKey = `banner_dismissed_${btoa(message).slice(0, 32)}`;
    const wasDismissed = localStorage.getItem(dismissedKey) === '1';
    setDismissed(wasDismissed);
  }, [message]);

  if (!enabled || !message || dismissed) return null;

  function handleDismiss() {
    const dismissedKey = `banner_dismissed_${btoa(message).slice(0, 32)}`;
    localStorage.setItem(dismissedKey, '1');
    setDismissed(true);
  }

  return (
    <div className="w-full bg-red-600 text-white px-4 py-3 flex items-center justify-between relative z-50 shadow-md">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <span className="text-lg flex-shrink-0">⚠️</span>
        <p className="text-sm font-medium leading-snug">{message}</p>
      </div>
      <button
        onClick={handleDismiss}
        className="ml-4 text-white/80 hover:text-white text-2xl font-bold flex-shrink-0 leading-none"
        aria-label="Dismiss announcement"
      >
        ×
      </button>
    </div>
  );
}
