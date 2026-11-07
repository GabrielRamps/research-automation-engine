/**
 * Mega-sites and aggregators excluded from organic/SERP competitor analysis.
 * These sites appear in SERP results for nearly any query and are not meaningful
 * competitors for local businesses.
 */
export const EXCLUDED_COMPETITOR_DOMAINS = new Set([
  // Social media
  'facebook.com', 'www.facebook.com', 'm.facebook.com',
  'instagram.com', 'www.instagram.com',
  'twitter.com', 'x.com', 'www.twitter.com',
  'tiktok.com', 'www.tiktok.com',
  'linkedin.com', 'www.linkedin.com',
  'pinterest.com', 'www.pinterest.com',
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  // Directories & review aggregators
  'yelp.com', 'www.yelp.com',
  'yellowpages.com', 'www.yellowpages.com',
  'bbb.org', 'www.bbb.org',
  'angi.com', 'www.angi.com',
  'angieslist.com', 'www.angieslist.com',
  'homeadvisor.com', 'www.homeadvisor.com',
  'thumbtack.com', 'www.thumbtack.com',
  'nextdoor.com', 'www.nextdoor.com',
  'tripadvisor.com', 'www.tripadvisor.com',
  'manta.com', 'www.manta.com',
  'chamberofcommerce.com', 'www.chamberofcommerce.com',
  'superpages.com', 'www.superpages.com',
  'whitepages.com', 'www.whitepages.com',
  'foursquare.com', 'www.foursquare.com',
  'houzz.com', 'www.houzz.com',
  'bark.com', 'www.bark.com',
  'porch.com', 'www.porch.com',
  // Maps & navigation
  'mapquest.com', 'www.mapquest.com',
  'google.com', 'www.google.com', 'maps.google.com',
  'apple.com', 'maps.apple.com',
  // Content mega-sites
  'reddit.com', 'www.reddit.com', 'old.reddit.com',
  'wikipedia.org', 'en.wikipedia.org',
  'quora.com', 'www.quora.com',
  // E-commerce
  'amazon.com', 'www.amazon.com',
  'walmart.com', 'www.walmart.com',
  'target.com', 'www.target.com',
  'ebay.com', 'www.ebay.com',
  'etsy.com', 'www.etsy.com',
  // Classifieds & jobs
  'craigslist.org', 'www.craigslist.org',
  'indeed.com', 'www.indeed.com',
  'glassdoor.com', 'www.glassdoor.com',
  // Real estate
  'zillow.com', 'www.zillow.com',
  'realtor.com', 'www.realtor.com',
  // Health & news
  'healthline.com', 'www.healthline.com',
  'webmd.com', 'www.webmd.com',
  'nytimes.com', 'www.nytimes.com',
  'cnn.com', 'www.cnn.com',
  'foxnews.com', 'www.foxnews.com',
]);

export function isExcludedDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const lower = domain.toLowerCase().replace(/^www\./, '');
  return EXCLUDED_COMPETITOR_DOMAINS.has(lower) || EXCLUDED_COMPETITOR_DOMAINS.has('www.' + lower);
}
