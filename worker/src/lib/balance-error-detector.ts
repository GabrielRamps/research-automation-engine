/**
 * Detects if an API error is due to insufficient balance/credits
 * Returns the service name if it's a balance error, null otherwise
 */

export type BalanceErrorInfo = {
  service: 'claude' | 'tavily' | 'dataforseo';
  message: string;
  instructions: string;
  link: string;
};

export function detectBalanceError(error: any): BalanceErrorInfo | null {
  const errorMessage = (error.message || '').toLowerCase();
  const errorStatus = error.status || error.statusCode || error.code;
  const errorBody = error.error || error.response?.data || {};

  // Anthropic/Claude balance errors
  // CRITICAL: Also check for 400 BadRequest with credit balance messages
  if (
    errorStatus === 402 || // Payment Required
    errorStatus === 400 || // BadRequest (can indicate balance issues)
    (errorStatus === 403 && (
      errorMessage.includes('insufficient') ||
      errorMessage.includes('balance') ||
      errorMessage.includes('credit') ||
      errorMessage.includes('payment') ||
      errorMessage.includes('billing')
    )) ||
    errorMessage.includes('insufficient credits') ||
    errorMessage.includes('insufficient balance') ||
    errorMessage.includes('credit balance is too low') ||
    errorMessage.includes('credit balance') ||
    errorMessage.includes('payment required') ||
    errorMessage.includes('billing limit') ||
    errorMessage.includes('account balance') ||
    (errorBody.error && typeof errorBody.error === 'string' && errorBody.error.toLowerCase().includes('balance')) ||
    (errorBody.error && typeof errorBody.error === 'object' && errorBody.error.message?.includes('credit balance'))
  ) {
    // Check if it's from Anthropic SDK
    if (error.constructor?.name?.includes('Anthropic') || 
        error.constructor?.name?.includes('BadRequest') ||
        errorMessage.includes('anthropic') ||
        errorMessage.includes('claude') ||
        error.response?.url?.includes('anthropic.com') ||
        error.config?.url?.includes('anthropic.com')) {
      return {
        service: 'claude',
        message: 'Your Claude API key has insufficient balance',
        instructions: 'Please add credits to your Anthropic account. Visit your Anthropic dashboard to add a payment method and top up your balance.',
        link: 'https://console.anthropic.com/settings/billing'
      };
    }
  }

  // Tavily balance errors
  if (
    errorStatus === 402 ||
    (errorStatus === 403 && (
      errorMessage.includes('insufficient') ||
      errorMessage.includes('balance') ||
      errorMessage.includes('credit') ||
      errorMessage.includes('quota') ||
      errorMessage.includes('limit exceeded')
    )) ||
    errorMessage.includes('insufficient credits') ||
    errorMessage.includes('account balance') ||
    errorMessage.includes('quota exceeded') ||
    (errorMessage.includes('rate limit') && errorMessage.includes('balance')) ||
    (errorBody.error && typeof errorBody.error === 'string' && (
      errorBody.error.toLowerCase().includes('balance') ||
      errorBody.error.toLowerCase().includes('insufficient')
    ))
  ) {
    // Check if it's from Tavily
    if (errorMessage.includes('tavily') || 
        error.response?.url?.includes('tavily.com') ||
        error.config?.baseURL?.includes('tavily.com') ||
        error.config?.url?.includes('tavily.com')) {
      return {
        service: 'tavily',
        message: 'Your Tavily API key has insufficient balance',
        instructions: 'Please add credits to your Tavily account. Visit your Tavily dashboard to add credits.',
        link: 'https://app.tavily.com/billing'
      };
    }
  }

  // DataForSEO balance errors
  if (
    error.name === 'DataForSEOBalanceError' ||
    (errorStatus === 402 && (
      errorMessage.includes('dataforseo') ||
      error.response?.url?.includes('dataforseo.com') ||
      error.config?.url?.includes('dataforseo.com')
    )) ||
    (errorMessage.includes('insufficient') && errorMessage.includes('dataforseo')) ||
    (errorMessage.includes('insufficient balance') && errorMessage.includes('add funds')) ||
    (errorMessage.includes('dataforseo') && errorMessage.includes('balance')) ||
    (errorMessage.includes('consecutive failures') && errorMessage.includes('dataforseo'))
  ) {
    return {
      service: 'dataforseo',
      message: 'Your DataForSEO account has insufficient balance',
      instructions: 'Please add funds to your DataForSEO account. Visit your DataForSEO billing dashboard to top up your balance.',
      link: 'https://app.dataforseo.com/billing'
    };
  }

  return null;
}
