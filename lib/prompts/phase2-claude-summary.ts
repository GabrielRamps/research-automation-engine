export const PHASE2_CLAUDE_SUMMARY_PROMPT = `Analyze the keyword research provided and create a structured summary with:

1. **Top 20 Priority Keywords:** With volume, competition, intent scores
2. **Content Calendar:** Top 10 blog/FAQ topics in priority order
3. **Page Architecture:** Required pages based on keyword clusters
4. **SEO Metadata Templates:** Title and description formulas for main page types
5. **Quick Win Keywords:** 5-7 keywords that are high-value, low-competition
6. **Seasonal Patterns:** Any time-based keyword opportunities

Keep summary under 1500 words. This will feed into later research phases.

<research_data>
{{RESEARCH_DATA}}
</research_data>`;

export async function buildPhase2SummaryPrompt(researchData: string): Promise<string> {
  const { loadPrompt } = await import('@/lib/prompt-loader');
  const promptTemplate = await loadPrompt('phase2_claude_summary', PHASE2_CLAUDE_SUMMARY_PROMPT);
  
  return promptTemplate
    .replace(/\{\{RESEARCH_DATA\}\}/g, researchData);
}

