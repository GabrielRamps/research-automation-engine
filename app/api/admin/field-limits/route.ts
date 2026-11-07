import { NextRequest, NextResponse } from 'next/server';
import { calculateTavilyFieldLimits } from '@/lib/tavily-prompt-validator';

export const dynamic = 'force-dynamic';

/**
 * GET - Calculate and return field character limits based on Tavily prompts
 * Public endpoint - no authentication required
 */
export async function GET(request: NextRequest) {
  try {
    const limits = await calculateTavilyFieldLimits();
    
    return NextResponse.json({ 
      limits,
      message: 'Field limits calculated based on active Tavily prompts'
    });
  } catch (error: any) {
    console.error('[API] Error calculating field limits:', error);
    
    // Return fallback defaults even on error
    return NextResponse.json(
      { 
        error: error.message,
        limits: {
          services: 150,
          targetAudience: 100,
          industry: 50,
          location: 50
        },
        message: 'Using fallback defaults due to error'
      },
      { status: 500 }
    );
  }
}
