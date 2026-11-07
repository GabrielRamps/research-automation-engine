export const PHASE2_CLAUDE_SUMMARY_PROMPT = `Analyze the keyword research provided and create a structured summary with:

1. **Top 20 Priority Keywords:** Focus on themes and topics; do NOT cite or invent specific search volume or cost-per-click numbers from web search. Use only qualitative themes, content topics, and high-level competition context. Quantitative keyword metrics (volume, CPC, difficulty) will be supplied from DataForSEO in a later phase when available.
2. **Content Calendar:** Top 10 blog/FAQ topics in priority order
3. **Page Architecture:** Required pages based on keyword clusters
4. **SEO Metadata Templates:** Title and description formulas for main page types
5. **Quick Win Keywords:** 5-7 keywords that are high-value, low-competition (describe qualitatively; no volume/CPC from web search)
6. **Seasonal Patterns:** Any time-based keyword opportunities

Keep summary under 1500 words. This will feed into later research phases.

<research_data>
{{RESEARCH_DATA}}
</research_data>`;

export async function buildPhase2SummaryPrompt(researchData: string): Promise<string> {
  const { loadPrompt } = await import('../prompt-loader');
  const promptTemplate = await loadPrompt('phase2_claude_summary', PHASE2_CLAUDE_SUMMARY_PROMPT);
  
  return promptTemplate
    .replace(/\{\{RESEARCH_DATA\}\}/g, researchData);
}

