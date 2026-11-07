export const PHASE3_CLAUDE_SUMMARY_PROMPT = `Analyze the national/regional industry research and create a structured summary with:

1. **Industry Benchmark Scorecard:** How local market compares to national standards
2. **Best Practice Site Structure:** Recommended architecture based on top performers
3. **Trust Signal Checklist:** Required credentials, certifications, guarantees for this industry
4. **Offer Framework:** Optimal lead magnet and risk reversal strategy
5. **Differentiation Opportunities:** 3-5 ways to stand out from both local and national competition
6. **Seasonal Content/Promo Calendar:** When to push what messages

Keep summary under 1500 words. This will feed into synthesis phase.

<research_data>
{{RESEARCH_DATA}}
</research_data>`;

export async function buildPhase3SummaryPrompt(researchData: string): Promise<string> {
  const { loadPrompt } = await import('../prompt-loader');
  const promptTemplate = await loadPrompt('phase3_claude_summary', PHASE3_CLAUDE_SUMMARY_PROMPT);
  
  return promptTemplate
    .replace(/\{\{RESEARCH_DATA\}\}/g, researchData);
}

