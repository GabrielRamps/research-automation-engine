import { tavily } from '@tavily/core';

export interface TavilySearchOptions {
  query: string;
  searchDepth?: 'basic' | 'advanced';
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  includeRawContent?: boolean;
}

export interface TavilySearchResult {
  url: string;
  title: string;
  content: string;
  score: number;
  published_date?: string;
}

export interface TavilyResearchOptions {
  query: string;
  topic?: string;
  days?: number;
  maxResults?: number;
  searchDepth?: 'basic' | 'advanced';
  includeAnswer?: boolean | 'basic' | 'advanced';
  includeImages?: boolean;
  timeRange?: string;
  includeRawContent?: boolean | 'markdown' | 'text';
  includeDomains?: string[];
  excludeDomains?: string[];
  model?: 'auto' | 'pro' | 'mini';
}

export interface TavilyResearchResult {
  answer?: string;
  query: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
    published_date?: string;
  }>;
  images?: string[];
  follow_up_questions?: string[];
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
      excludeDomains: options.excludeDomains || []
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

/**
 * Use Tavily's Research API for deep, comprehensive research
 * This performs extraction, summarization, and multi-source synthesis
 * Returns 100+ sources with AI-generated summary
 */
export async function researchWithTavily(
  apiKey: string,
  options: TavilyResearchOptions
): Promise<TavilyResearchResult> {
  const tavilyClient = tavily({ apiKey });
  
  // Truncate query to 400 characters max
  const truncatedQuery = truncateQuery(options.query, 400);
  
  try {
    // Build search options with all configurable parameters
    const searchOptions: any = {
      searchDepth: options.searchDepth || 'advanced',
      maxResults: options.maxResults || 50,
      includeAnswer: options.includeAnswer !== false ? options.includeAnswer : false,
      includeRawContent: options.includeRawContent !== undefined ? options.includeRawContent : true,
      includeDomains: options.includeDomains || [],
      excludeDomains: options.excludeDomains || [],
      model: options.model || 'auto'
    };

    // Add optional parameters if provided
    if (options.topic) {
      searchOptions.topic = options.topic;
    }
    
    if (options.timeRange) {
      searchOptions.days = options.timeRange;
    }
    
    if (options.includeImages !== undefined) {
      searchOptions.includeImages = options.includeImages;
    }

    const response = await tavilyClient.search(truncatedQuery, searchOptions);
    
    return {
      answer: response.answer,
      query: options.query, // Return original query, not truncated
      results: response.results || [],
      images: response.images?.map((img: any) => typeof img === 'string' ? img : img.url) || [],
      follow_up_questions: (response as any).followUpQuestions || []
    };
  } catch (error: any) {
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
