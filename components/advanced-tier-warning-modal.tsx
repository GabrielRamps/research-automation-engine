'use client';

import { Button } from '@/components/ui/button';

interface Props {
  onChooseIntermediate: () => void;
  onContinueAdvanced: () => void;
}

export function AdvancedTierWarningModal({ onChooseIntermediate, onContinueAdvanced }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg mx-4 glass-panel rounded-xl border border-orange-500/30 p-6 shadow-2xl animate-in fade-in zoom-in duration-200 antialiased">
        <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
          <span className="text-2xl">⚠️</span>
          Advanced Tier Notice
        </h2>
        
        <div className="space-y-4 mb-6">
          <p className="text-gray-300">
            The <strong className="text-orange-400">Advanced tier</strong> is specifically designed for businesses with <strong>established websites</strong> that already have backlinks.
          </p>
          
          <div className="rounded-lg bg-orange-500/10 border border-orange-500/30 p-4">
            <p className="text-sm text-orange-300 font-medium mb-2">
              What makes Advanced different?
            </p>
            <p className="text-sm text-gray-400">
              The main value of the Advanced tier is analyzing your existing <strong>backlink profile</strong>, including referring domains, anchor text distribution, and link-building opportunities.
            </p>
          </div>

          <div className="rounded-lg bg-cyan-electric/10 border border-cyan-electric/30 p-4">
            <p className="text-sm text-cyan-300 font-medium mb-2">
              ⭐ Recommended: Intermediate Tier
            </p>
            <p className="text-sm text-gray-400">
              If you don't have a website yet or don't have established backlinks, the <strong>Intermediate tier</strong> is the most popular choice and provides comprehensive SEO analysis without backlink data.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={onChooseIntermediate}
            className="flex-1 h-auto min-h-[3.25rem] py-3 px-4 bg-cyan-electric hover:bg-cyan-electric/90 text-white font-semibold text-center whitespace-normal leading-snug antialiased"
          >
            Choose Intermediate (Recommended)
          </Button>
          <Button
            onClick={onContinueAdvanced}
            variant="outline"
            className="flex-1 border-orange-500/50 text-orange-300 hover:bg-orange-500/10"
          >
            Continue with Advanced
          </Button>
        </div>
      </div>
    </div>
  );
}
