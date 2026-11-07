import { ResearchSession } from './session-manager';

/**
 * Injects session data into prompt templates by replacing placeholders
 * with actual user data from the research session.
 * 
 * Supported placeholders:
 * - {{INDUSTRY}} - User's industry
 * - {{LOCATION}} - User's location
 * - {{BUSINESS_NAME}} - User's business name
 * - {{SERVICES}} - User's primary services (used in Tavily research)
 * - {{ADDITIONAL_SERVICES}} - User's additional services (Phase 4 only)
 * - {{ALL_SERVICES}} - Combined primary + additional services
 * - {{TARGET_AUDIENCE}} - User's target audience
 * - {{PROJECT_TYPE}} - Type of project (website, landing page, etc.)
 * - {{SEARCH_RADIUS}} - Search radius in miles
 * - {{BRAND_COLORS}} - User's brand colors
 * 
 * New business information placeholders:
 * - {{BUSINESS_TYPE}} - Type of business (e.g., Plumber, Electrician, Legal Services)
 * - {{PRIMARY_SERVICE}} - Primary service offered
 * - {{CITY}} - City where business operates
 * - {{STATE}} - State where business operates
 * - {{PHONE_NUMBER}} - Business phone number
 * - {{STREET_ADDRESS}} - Business street address
 * - {{ZIP_CODE}} - Business ZIP code
 * - {{OPERATING_HOURS}} - Business operating hours
 * - {{SERVICE_AREA}} - Service area in miles
 * - {{YEARS_IN_BUSINESS}} - Years in business
 * - {{LICENSE_NUMBER}} - Business license number
 * - {{BRAND_COLORS_LIST}} - Comma-separated list of brand colors
 * 
 * @param promptTemplate - Template string with placeholders
 * @param session - Research session containing user data
 * @returns Prompt with all placeholders replaced with actual data
 */
export function injectSessionData(
  promptTemplate: string,
  session: ResearchSession
): string {
  // Prepare brand colors list from array
  const brandColorsList = session.brand_colors_array && session.brand_colors_array.length > 0
    ? session.brand_colors_array.join(', ')
    : session.brand_colors || 'Not specified';
  
  return promptTemplate
    // Original fields
    .replace(/\{\{INDUSTRY\}\}/g, session.industry || session.business_type || 'general')
    .replace(/\{\{LOCATION\}\}/g, session.location)
    .replace(/\{\{BUSINESS_NAME\}\}/g, session.business_name)
    .replace(/\{\{SERVICES\}\}/g, session.services || 'general')
    .replace(/\{\{ADDITIONAL_SERVICES\}\}/g, session.additional_services || '')
    .replace(/\{\{ALL_SERVICES\}\}/g, [session.services, session.additional_services].filter(Boolean).join(', ') || 'general')
    .replace(/\{\{TARGET_AUDIENCE\}\}/g, session.target_audience || 'general public')
    .replace(/\{\{PROJECT_TYPE\}\}/g, session.project_type)
    .replace(/\{\{SEARCH_RADIUS\}\}/g, session.search_radius?.toString() || '25')
    .replace(/\{\{BRAND_COLORS\}\}/g, brandColorsList)
    
    // New business information fields
    .replace(/\{\{BUSINESS_TYPE\}\}/g, session.business_type || 'Not specified')
    .replace(/\{\{PRIMARY_SERVICE\}\}/g, session.primary_service || 'Not specified')
    .replace(/\{\{CITY\}\}/g, session.city || 'Not specified')
    .replace(/\{\{STATE\}\}/g, session.state || 'Not specified')
    .replace(/\{\{PHONE_NUMBER\}\}/g, session.phone_number || 'Not specified')
    .replace(/\{\{STREET_ADDRESS\}\}/g, session.street_address || 'Not specified')
    .replace(/\{\{ZIP_CODE\}\}/g, session.zip_code || 'Not specified')
    .replace(/\{\{OPERATING_HOURS\}\}/g, session.operating_hours || 'Not specified')
    .replace(/\{\{SERVICE_AREA\}\}/g, session.service_area?.toString() || session.search_radius?.toString() || '30')
    .replace(/\{\{YEARS_IN_BUSINESS\}\}/g, session.years_in_business || 'Not specified')
    .replace(/\{\{LICENSE_NUMBER\}\}/g, session.license_number || 'Not specified')
    .replace(/\{\{BRAND_COLORS_LIST\}\}/g, brandColorsList);
}
