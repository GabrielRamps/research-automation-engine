export const PHASE1_CLAUDE_SUMMARY_PROMPT = `Analyze the competitive intelligence research provided and create a structured summary with:

1. **Competitive Landscape Score:** Rate market saturation (high/medium/low) with reasoning
2. **Top 5 Competitors:** Names, strengths, weaknesses
3. **Customer Pain Points:** Top 5 extracted from reviews
4. **Conversion Best Practices:** Top 5 patterns to emulate
5. **Competitive Gaps:** 3-5 opportunities competitors are missing
6. **Key Metrics:** Average review count, average rating, common service offerings

Keep summary under 1500 words. This will feed into later research phases.

<research_data>
{{RESEARCH_DATA}}
</research_data>`;

export async function buildPhase1SummaryPrompt(researchData: string): Promise<string> {
  const { loadPrompt } = await import('@/lib/prompt-loader');
  const promptTemplate = await loadPrompt('phase1_claude_summary', PHASE1_CLAUDE_SUMMARY_PROMPT);
  
  return promptTemplate
    .replace(/\{\{RESEARCH_DATA\}\}/g, researchData);
}

