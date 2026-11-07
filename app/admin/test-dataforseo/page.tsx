'use client';

import { useState } from 'react';
import AdminNav from '@/components/AdminNav';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ServiceSelector } from '@/components/service-selector';
import { CityAutocomplete } from '@/components/ui/city-autocomplete';

type Tier = 'basic' | 'intermediate' | 'advanced';

interface TierOption {
  label: string;
  description: string;
  hint: string;
}

const TIER_OPTIONS: Record<Tier, TierOption> = {
  basic: {
    label: 'Basic',
    description: 'Tavily + Claude only',
    hint: 'Claude keywords (16K tokens)',
  },
  intermediate: {
    label: 'Intermediate',
    description: 'Tavily + DataForSEO (49 calls)',
    hint: 'Claude keywords (32K tokens) + 7 SEO waves',
  },
  advanced: {
    label: 'Advanced',
    description: 'Full DataForSEO (54 calls, incl. backlinks)',
    hint: 'Claude keywords (50K tokens) + 7 SEO waves + backlinks',
  },
};

export default function TestDataForSEOPage() {
  const [sessionId, setSessionId] = useState('');

  // Core required fields
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const [additionalServices, setAdditionalServices] = useState<string[]>([]);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [tier, setTier] = useState<Tier>('intermediate');

  // Location & service area
  const [streetAddress, setStreetAddress] = useState('');
  const [serviceAreaCities, setServiceAreaCities] = useState<string[]>(['']);

  // Business details
  const [targetAudience, setTargetAudience] = useState('');
  const [targetCustomerType, setTargetCustomerType] = useState<'residential' | 'commercial' | 'both'>('both');
  const [uniqueSellingPoints, setUniqueSellingPoints] = useState('');
  const [operatingHours, setOperatingHours] = useState('');
  const [yearsInBusiness, setYearsInBusiness] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [googleBusinessUrl, setGoogleBusinessUrl] = useState('');

  // Competitive intelligence
  const [competitorDomains, setCompetitorDomains] = useState('');
  const [brandKeywords, setBrandKeywords] = useState('');
  const [certifications, setCertifications] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ sessionId: string; jobId: string; resultsUrl?: string } | null>(null);

  const useExistingSession = sessionId.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const body = useExistingSession
        ? { sessionId: sessionId.trim() }
        : {
            city: city.trim(),
            state: state.trim(),
            zipCode: zipCode.trim() || undefined,
            businessName: businessName.trim(),
            businessType: businessType.trim() || undefined,
            primaryService: services[0] || businessType.trim(),
            services: services.join(', ') || undefined,
            additionalServices: additionalServices.join(', ') || undefined,
            websiteUrl: websiteUrl.trim() || undefined,
            tier,
            streetAddress: streetAddress.trim() || undefined,
            serviceAreaCities: serviceAreaCities.filter((c) => c.trim() !== '').length > 0
              ? serviceAreaCities.filter((c) => c.trim() !== '')
              : undefined,
            targetAudience: targetAudience.trim() || undefined,
            targetCustomerType,
            uniqueSellingPoints: uniqueSellingPoints.trim() || undefined,
            operatingHours: operatingHours.trim() || undefined,
            yearsInBusiness: yearsInBusiness.trim() || undefined,
            licenseNumber: licenseNumber.trim() || undefined,
            googleBusinessUrl: googleBusinessUrl.trim() || undefined,
            competitorDomains: competitorDomains.trim()
              ? competitorDomains.split(',').map((d) => d.trim()).filter(Boolean)
              : undefined,
            brandKeywords: brandKeywords.trim()
              ? brandKeywords.split(',').map((k) => k.trim()).filter(Boolean)
              : undefined,
            certifications: certifications.trim()
              ? certifications.split(',').map((c) => c.trim()).filter(Boolean)
              : undefined,
          };
      const res = await fetch('/api/admin/test-dataforseo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`);
        return;
      }
      setResult({
        sessionId: data.sessionId,
        jobId: data.jobId,
        resultsUrl: data.resultsUrl,
      });
    } catch (err: any) {
      setError(err.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  const selectCls =
    'w-full px-4 py-3 border border-white/10 bg-navy-dark/70 backdrop-blur-sm rounded-lg focus:ring-2 focus:ring-cyan-electric focus:border-cyan-electric focus:shadow-glow-cyan outline-none transition text-white';
  const textareaCls =
    'w-full px-4 py-3 border border-white/10 bg-navy-dark/70 backdrop-blur-sm rounded-lg focus:ring-2 focus:ring-cyan-electric focus:border-cyan-electric focus:shadow-glow-cyan outline-none transition text-white placeholder:text-gray-400 resize-y';

  return (
    <div className="min-h-screen bg-navy-deep text-white py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <AdminNav />

        {/* Header */}
        <div className="mt-8 mb-8">
          <h1 className="text-3xl font-bold text-white">Test DataForSEO Pipeline</h1>
          <p className="text-gray-400 text-sm mt-1">
            Run only the DataForSEO pipeline (Claude keyword generation + Waves 1-7 + compile).
            No Tavily and no Phase 4 synthesis.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="glass-panel rounded-xl p-8 space-y-8">

          {/* ===== USE EXISTING SESSION ===== */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white border-b border-cyan-electric/30 pb-2">
              Existing Session
            </h2>
            <div>
              <label htmlFor="sessionId" className="block text-sm font-medium text-gray-300 mb-2">
                Use existing session <span className="text-xs text-gray-400">(Optional)</span>
              </label>
              <Input
                id="sessionId"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                placeholder="Paste session ID to use that session's data"
              />
              <p className="text-xs text-gray-400 mt-1">
                If provided, all fields below are ignored — the test uses the session's existing data.
              </p>
            </div>
          </div>

          {!useExistingSession && (
            <div className="border-t border-white/10 pt-2">
              <p className="text-sm text-gray-400">
                Or fill in the form below to create a one-off test session (uses your DataForSEO keys):
              </p>
            </div>
          )}

          {/* ===== TIER SELECTION ===== */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white border-b border-cyan-electric/30 pb-2">
              Research Tier
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(Object.entries(TIER_OPTIONS) as [Tier, TierOption][]).map(([key, opt]) => {
                const selected = tier === key;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={useExistingSession}
                    onClick={() => setTier(key)}
                    className={`
                      relative text-left p-5 rounded-xl border-2 transition-all duration-200
                      ${selected
                        ? 'border-cyan-electric bg-cyan-electric/10 shadow-glow-cyan'
                        : 'border-white/10 bg-navy-dark/70 hover:border-white/30 hover:bg-navy-dark/90'
                      }
                      disabled:opacity-50 disabled:cursor-not-allowed
                    `}
                  >
                    {selected && (
                      <div className="absolute top-3 right-3 w-3 h-3 rounded-full bg-cyan-electric animate-pulse" />
                    )}
                    <div className="space-y-2">
                      <h3 className={`text-lg font-bold ${selected ? 'text-cyan-electric' : 'text-white'}`}>
                        {opt.label}
                      </h3>
                      <p className="text-xs text-gray-400">{opt.description}</p>
                      <p className="text-xs text-gray-500 pt-1 border-t border-white/10">{opt.hint}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ===== CORE BUSINESS INFO ===== */}
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white border-b border-cyan-electric/30 pb-2">
              Core Business Info
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="businessName" className="block text-sm font-medium text-gray-300 mb-2">
                  Business Name <span className="text-cyan-electric">*</span>
                </label>
                <Input
                  id="businessName"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  required={!useExistingSession}
                  disabled={useExistingSession}
                  placeholder="e.g. Acme Plumbing"
                />
              </div>
              <div>
                <label htmlFor="businessType" className="block text-sm font-medium text-gray-300 mb-2">
                  Business Type
                </label>
                <Input
                  id="businessType"
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  disabled={useExistingSession}
                  placeholder="e.g. Videography Company"
                />
                <p className="text-xs text-gray-400 mt-1">Maps to industry if not set separately.</p>
              </div>
            </div>

            <div>
              <label htmlFor="websiteUrl" className="block text-sm font-medium text-gray-300 mb-2">
                Website URL <span className="text-xs text-gray-400">(Optional)</span>
              </label>
              <Input
                id="websiteUrl"
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                disabled={useExistingSession}
                placeholder="https://..."
              />
            </div>

          </div>

          {/* ===== SERVICES OFFERED ===== */}
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white border-b border-cyan-electric/30 pb-2">
              Services Offered
            </h2>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Primary Services <span className="text-cyan-electric">*</span>
                <span className="text-xs text-gray-400 ml-2">
                  ({services.length}/6 selected)
                </span>
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Select up to 6 of your most important services. The first selected service is used as your primary service for keyword research.
              </p>
              {!useExistingSession && (
                <ServiceSelector
                  selected={services}
                  onChange={setServices}
                  maxSelections={6}
                  excludeServices={additionalServices}
                />
              )}
              {useExistingSession && (
                <p className="text-xs text-gray-500 italic">Disabled — using existing session data.</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Additional Services (optional)
                {additionalServices.length > 0 && (
                  <span className="text-xs text-gray-400 ml-2">
                    ({additionalServices.length} selected)
                  </span>
                )}
              </label>
              <p className="text-xs text-gray-500 mb-2">
                These will be included in your final report and build prompts but not in web research.
              </p>
              {!useExistingSession && (
                <ServiceSelector
                  selected={additionalServices}
                  onChange={setAdditionalServices}
                  excludeServices={services}
                />
              )}
              {useExistingSession && (
                <p className="text-xs text-gray-500 italic">Disabled — using existing session data.</p>
              )}
            </div>
          </div>

          {/* ===== SERVICE LOCATION ===== */}
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white border-b border-cyan-electric/30 pb-2">
              Service Location
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label htmlFor="city" className="block text-sm font-medium text-gray-300 mb-2">
                  City <span className="text-cyan-electric">*</span>
                </label>
                <Input
                  id="city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  required={!useExistingSession}
                  disabled={useExistingSession}
                  placeholder="e.g. Lakeland"
                />
              </div>
              <div>
                <label htmlFor="state" className="block text-sm font-medium text-gray-300 mb-2">
                  State <span className="text-cyan-electric">*</span>
                </label>
                <Input
                  id="state"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  required={!useExistingSession}
                  disabled={useExistingSession}
                  placeholder="e.g. Florida"
                />
              </div>
              <div>
                <label htmlFor="zipCode" className="block text-sm font-medium text-gray-300 mb-2">
                  Zip Code
                </label>
                <Input
                  id="zipCode"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value)}
                  disabled={useExistingSession}
                  placeholder="e.g. 33801"
                />
              </div>
            </div>

            <div>
              <label htmlFor="streetAddress" className="block text-sm font-medium text-gray-300 mb-2">
                Street Address <span className="text-xs text-gray-400">(Optional)</span>
              </label>
              <Input
                id="streetAddress"
                value={streetAddress}
                onChange={(e) => setStreetAddress(e.target.value)}
                disabled={useExistingSession}
                placeholder="e.g. 123 Main St"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Service Area Cities (up to 10)
              </label>
              <p className="text-xs text-gray-400 mb-2">
                Per-city keyword volume and SERP data will be fetched for each.
              </p>
              {serviceAreaCities.map((city, index) => (
                <div key={index} className="flex items-center gap-2 mb-2">
                  <CityAutocomplete
                    value={city}
                    onChange={(val) => {
                      const updated = [...serviceAreaCities];
                      updated[index] = val;
                      setServiceAreaCities(updated);
                    }}
                    placeholder="e.g., Grand Blanc, MI"
                    className="flex-1"
                    disabled={useExistingSession}
                  />
                  {serviceAreaCities.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const updated = serviceAreaCities.filter((_, i) => i !== index);
                        setServiceAreaCities(updated.length === 0 ? [''] : updated);
                      }}
                      className="text-red-400 hover:text-red-300 text-sm px-2 py-1"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              {serviceAreaCities.length < 10 && (
                <button
                  type="button"
                  onClick={() => setServiceAreaCities([...serviceAreaCities, ''])}
                  className="text-xs text-cyan-electric hover:text-cyan-300 mt-1"
                  disabled={useExistingSession}
                >
                  + Add another city
                </button>
              )}
            </div>
          </div>

          {/* ===== BUSINESS DETAILS ===== */}
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white border-b border-cyan-electric/30 pb-2">
              Business Details
            </h2>

            <div>
              <label htmlFor="targetAudience" className="block text-sm font-medium text-gray-300 mb-2">
                Target Audience
              </label>
              <textarea
                id="targetAudience"
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                rows={2}
                disabled={useExistingSession}
                className={textareaCls}
                placeholder="e.g. Engaged couples, corporate event planners, small business owners needing promo videos"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Target Customer Type
                </label>
                <div className="flex gap-4 mt-1">
                  {(['residential', 'commercial', 'both'] as const).map((type) => (
                    <label key={type} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="targetCustomerType"
                        value={type}
                        checked={targetCustomerType === type}
                        onChange={(e) => setTargetCustomerType(e.target.value as 'residential' | 'commercial' | 'both')}
                        disabled={useExistingSession}
                        className="text-cyan-electric focus:ring-cyan-electric"
                      />
                      <span className="text-sm text-gray-300 capitalize">{type}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="yearsInBusiness" className="block text-sm font-medium text-gray-300 mb-2">
                  Years in Business
                </label>
                <Input
                  id="yearsInBusiness"
                  value={yearsInBusiness}
                  onChange={(e) => setYearsInBusiness(e.target.value)}
                  disabled={useExistingSession}
                  placeholder="e.g. 5"
                />
              </div>
            </div>

            <div>
              <label htmlFor="uniqueSellingPoints" className="block text-sm font-medium text-gray-300 mb-2">
                Unique Selling Points
              </label>
              <textarea
                id="uniqueSellingPoints"
                value={uniqueSellingPoints}
                onChange={(e) => setUniqueSellingPoints(e.target.value)}
                rows={2}
                disabled={useExistingSession}
                className={textareaCls}
                placeholder="e.g. Same-day turnaround, 4K cinema quality, FAA-licensed drone pilot"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="operatingHours" className="block text-sm font-medium text-gray-300 mb-2">
                  Operating Hours
                </label>
                <Input
                  id="operatingHours"
                  value={operatingHours}
                  onChange={(e) => setOperatingHours(e.target.value)}
                  disabled={useExistingSession}
                  placeholder="e.g. Mon-Fri 8am-6pm"
                />
              </div>
              <div>
                <label htmlFor="licenseNumber" className="block text-sm font-medium text-gray-300 mb-2">
                  License Number
                </label>
                <Input
                  id="licenseNumber"
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                  disabled={useExistingSession}
                  placeholder="e.g. FL-12345"
                />
              </div>
            </div>

            <div>
              <label htmlFor="googleBusinessUrl" className="block text-sm font-medium text-gray-300 mb-2">
                Google Business URL <span className="text-xs text-gray-400">(Optional)</span>
              </label>
              <Input
                id="googleBusinessUrl"
                type="url"
                value={googleBusinessUrl}
                onChange={(e) => setGoogleBusinessUrl(e.target.value)}
                disabled={useExistingSession}
                placeholder="https://business.google.com/..."
              />
            </div>
          </div>

          {/* ===== COMPETITIVE INTELLIGENCE ===== */}
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white border-b border-cyan-electric/30 pb-2">
              Competitive Intelligence
            </h2>

            <div>
              <label htmlFor="competitorDomains" className="block text-sm font-medium text-gray-300 mb-2">
                Competitor Domains (comma-separated)
              </label>
              <Input
                id="competitorDomains"
                value={competitorDomains}
                onChange={(e) => setCompetitorDomains(e.target.value)}
                disabled={useExistingSession}
                placeholder="e.g. competitor1.com, competitor2.com"
              />
              <p className="text-xs text-gray-400 mt-1">Up to 5 competitor websites. Used for domain intersection analysis.</p>
            </div>

            <div>
              <label htmlFor="brandKeywords" className="block text-sm font-medium text-gray-300 mb-2">
                Brand Keywords (comma-separated)
              </label>
              <Input
                id="brandKeywords"
                value={brandKeywords}
                onChange={(e) => setBrandKeywords(e.target.value)}
                disabled={useExistingSession}
                placeholder="e.g. acme plumbing, acme plumbing co"
              />
              <p className="text-xs text-gray-400 mt-1">Up to 10 branded terms to track.</p>
            </div>

            <div>
              <label htmlFor="certifications" className="block text-sm font-medium text-gray-300 mb-2">
                Certifications (comma-separated)
              </label>
              <Input
                id="certifications"
                value={certifications}
                onChange={(e) => setCertifications(e.target.value)}
                disabled={useExistingSession}
                placeholder="e.g. FAA Part 107, Adobe Certified"
              />
              <p className="text-xs text-gray-400 mt-1">Up to 10 certifications. Used in keyword generation for trust signals.</p>
            </div>
          </div>

          {/* ===== ERROR DISPLAY ===== */}
          {error && (
            <div className="glass-panel-dark border border-red-500/30 rounded-lg p-4 bg-navy-dark/95">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* ===== SUBMIT ===== */}
          <Button
            type="submit"
            disabled={loading || (useExistingSession ? !sessionId.trim() : !(city?.trim() && state?.trim() && businessName?.trim() && services.length > 0))}
            className="w-full"
            size="lg"
          >
            {loading ? 'Queuing...' : 'Run DataForSEO Pipeline Test'}
          </Button>

          <p className="text-xs text-gray-400 text-center">
            This runs Claude keyword generation + DataForSEO waves 1-7 and compiles SEO data.
            No Tavily web research and no Phase 4 AI synthesis.
          </p>
        </form>

        {/* ===== RESULT CARD ===== */}
        {result && (
          <div className="mt-6 glass-panel rounded-xl p-6 border border-cyan-electric/30">
            <p className="font-semibold text-cyan-electric mb-3 text-lg">Test job queued</p>
            <div className="space-y-2 mb-4">
              <p className="text-sm text-gray-300">
                Session: <code className="bg-navy-dark/70 px-2 py-0.5 rounded text-xs font-mono">{result.sessionId}</code>
              </p>
              <p className="text-sm text-gray-300">
                Job ID: <code className="bg-navy-dark/70 px-2 py-0.5 rounded text-xs font-mono">{result.jobId}</code>
              </p>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              The worker will run Claude keyword generation + DataForSEO waves 1-7 and compile.
              When it finishes, open the results page to view the SEO Data tab.
            </p>
            {result.resultsUrl && (
              <a
                href={result.resultsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="sm">
                  Open results page →
                </Button>
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
