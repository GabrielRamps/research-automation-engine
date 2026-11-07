import { tavily } from '@tavily/core';

export interface TavilySearchOptions {
  query: string;
  searchDepth?: 'basic' | 'advanced';
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  includeRawContent?: boolean;
  model?: 'auto' | 'pro' | 'mini';
}

export interface TavilySearchResult {
  url: string;
  title: string;
  content: string;
  score: number;
  published_date?: string;
}

/**
 * Truncate query to Tavily's 400 character limit
 * Preserves the beginning of the query as it's usually most important
 */
function truncateQuery(query: string, maxLength: number = 400): string {
  if (query.length <= maxLength) {
    return query;
  }
  
  // Truncate to maxLength - 3 to leave room for ellipsis
  const truncated = query.substring(0, maxLength - 3).trim();
  console.warn(`[Tavily Client] Query truncated from ${query.length} to ${truncated.length} characters`);
  return truncated + '...';
}

export async function searchWithTavily(
  apiKey: string,
  options: TavilySearchOptions
): Promise<{ results: TavilySearchResult[] }> {
  const tavilyClient = tavily({ apiKey });
  
  // Truncate query to 400 characters max
  const truncatedQuery = truncateQuery(options.query, 400);
  
  try {
    const response = await tavilyClient.search(truncatedQuery, {
      searchDepth: options.searchDepth || 'advanced',
      maxResults: options.maxResults || 10,
      includeRawContent: options.includeRawContent ? 'text' : false,
      includeDomains: options.includeDomains || [],
      excludeDomains: options.excludeDomains || [],
      model: options.model || 'auto'
    });
    
    return response;
  } catch (error: any) {
    // Enhanced error handling
    if (error.message?.includes('insufficient') || error.message?.includes('balance')) {
      throw new Error('Tavily API balance insufficient');
    }
    if (error.message?.includes('unauthorized') || error.message?.includes('invalid')) {
      throw new Error('Tavily API key is invalid or unauthorized');
    }
    if (error.message?.includes('Query is too long') || error.message?.includes('too long')) {
      throw new Error(`Tavily query too long (${options.query.length} chars). Max length is 400 characters.`);
    }
    throw error;
  }
}
