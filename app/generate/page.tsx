'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FullPageLoading, InlineSpinner } from '@/components/ui/loading-spinner';
import { ServiceSelector } from '@/components/service-selector';
import { CityAutocomplete } from '@/components/ui/city-autocomplete';
import { ResearchConfirmationModal } from '@/components/research-confirmation-modal';
import { AdvancedTierWarningModal } from '@/components/advanced-tier-warning-modal';
import { KeyHealthGate } from '@/components/key-health-gate';
import { useFormDraft } from '@/lib/use-form-draft';

type Tier = 'basic' | 'intermediate' | 'advanced';

interface TierInfo {
  name: string;
  label: string;
  description: string;
  features: string[];
  estimatedCost: string;
  estimatedTime: string;
  requiredKeys: string[];
  warning?: string;
}

const TIER_INFO: Record<Tier, TierInfo> = {
  basic: {
    name: 'basic',
    label: 'Basic',
    description: 'Tavily web research + Claude AI synthesis',
    features: [
      'Web research via Tavily (3 phases)',
      'Competitive intelligence report',
      'SEO strategy recommendations',
      'CRO optimization guide',
      'Website wireframes & page copy',
      'Cursor-ready build prompts',
    ],
    estimatedCost: 'Free (uses your Tavily + Claude credits)',
    estimatedTime: '10–20 minutes',
    requiredKeys: ['Claude', 'Tavily'],
  },
  intermediate: {
    name: 'intermediate',
    label: 'Intermediate',
    description: 'Tavily + DataForSEO (49 API calls) + Claude AI',
    features: [
      'Everything in Basic, plus:',
      'Location-specific keyword research',
      'Google Business Profile deep dive',
      'Domain intelligence & Lighthouse audits',
      'Competitor domain analysis (up to 5)',
      'SERP tracking & Maps pack analysis',
      'On-page technical audit (100 pages)',
      'Content landscape & Google Trends',
      'Keyword-optimized page-by-page specs',
      '12-month blog content calendar',
    ],
    estimatedCost: '~$0.78 DataForSEO + Tavily/Claude credits',
    estimatedTime: '15–30 minutes',
    requiredKeys: ['Claude', 'Tavily', 'DataForSEO'],
  },
  advanced: {
    name: 'advanced',
    label: 'Advanced',
    description: 'Tavily + Full DataForSEO (54 API calls, incl. backlinks) + Claude AI',
    features: [
      'Everything in Intermediate, plus:',
      'Backlink profile analysis',
      'Referring domains breakdown',
      'Anchor text distribution',
      'Backlink competitor discovery',
      'Link-building opportunity map',
      'Internal linking strategy',
    ],
    estimatedCost: '~$0.94 DataForSEO + Tavily/Claude credits',
    estimatedTime: '15–35 minutes',
    requiredKeys: ['Claude', 'Tavily', 'DataForSEO'],
    warning: 'Requires minimum $100 DataForSEO balance and Backlinks API activated in your DataForSEO dashboard.',
  },
};

/** Normalize to #rrggbb for native color input; invalid values return #000000. */
function toHexColor(value: string): string {
  const v = value.replace(/^#/, '').trim();
  if (/^[0-9A-Fa-f]{6}$/.test(v)) return `#${v}`;
  if (/^[0-9A-Fa-f]{3}$/.test(v)) return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`;
  return '#000000';
}

function BrandColorRow({
  index,
  color,
  totalColors,
  canAdd,
  onColorChange,
  onAdd,
  onRemove,
}: {
  index: number;
  color: string;
  totalColors: number;
  canAdd: boolean;
  onColorChange: (hex: string) => void;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const hexForInput = color.trim() ? toHexColor(color) : '#6366f1';
  const displayHex = color.trim() || '';

  const handlePickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onColorChange(e.target.value);
  };

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onColorChange(e.target.value);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <input
          type="color"
          value={hexForInput}
          onChange={handlePickerChange}
          className="w-10 h-10 rounded border border-gray-500 cursor-pointer bg-transparent flex-shrink-0"
          title="Open color picker (includes dropper in Chrome/Edge)"
        />
        <Input
          value={displayHex}
          onChange={handleHexChange}
          placeholder="e.g. #2563eb"
          className="flex-1 min-w-[8rem] font-mono"
        />
      </div>
      {index === totalColors - 1 && canAdd && (
        <Button type="button" onClick={onAdd} className="px-4 py-2">
          + Add Color
        </Button>
      )}
      {totalColors > 1 && (
        <Button
          type="button"
          onClick={onRemove}
          className="px-4 py-2 bg-red-600 hover:bg-red-700"
        >
          Remove
        </Button>
      )}
    </div>
  );
}

export default function GeneratePage() {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showAdvancedWarning, setShowAdvancedWarning] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  // Track which API keys the user has validated
  const [validatedKeys, setValidatedKeys] = useState({
    claude: false,
    tavily: false,
    dataforseo: false,
  });

  // Track which tier cards have expanded features
  const [expandedTiers, setExpandedTiers] = useState<Record<Tier, boolean>>({
    basic: false,
    intermediate: false,
    advanced: false,
  });
  
  const [formData, setFormData] = useState({
    // Tier selection
    tier: 'basic' as Tier,

    businessName: '',
    industry: '',
    services: [] as string[],
    additionalServices: [] as string[],
    location: '',
    targetAudience: '',
    uniqueSellingPoints: '',
    contactEmail: '',
    projectType: 'Website',
    brandColors: '',
    
    // Business information fields
    businessType: '',
    city: '',
    state: '',
    phoneNumber: '',
    streetAddress: '',
    zipCode: '',
    operatingHours: '',
    hasBrandColors: false,
    brandColorsArray: [''],
    hasBrandFonts: false,
    brandFontsArray: [''],
    yearsInBusiness: '',
    licenseNumber: '',
    googleBusinessUrl: '',

    // New fields for Intermediate/Advanced tiers
    websiteUrl: '',
    serviceAreaCities: [''],
    competitorDomains: [''],
    targetCustomerType: 'both' as 'residential' | 'commercial' | 'both',
    brandKeywords: [''],
    certifications: [''],
  });

  // Persist form to localStorage + Supabase so users never lose work
  // (e.g., if a provider is down and they get blocked at the gate).
  const draft = useFormDraft({
    state: formData,
    setState: setFormData,
    ready: !loading,
  });

  // Field character limits based on Tavily prompt templates
  const [fieldLimits, setFieldLimits] = useState({
    services: 150,
    targetAudience: 100,
    industry: 50,
    location: 50
  });
  
  useEffect(() => {
    checkAuth();
    fetchFieldLimits();
  }, []);
  
  async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push('/');
      return;
    }
    
    // Check if user has API keys configured
    try {
      const response = await fetch(`/api/keys/save?userId=${session.user.id}`);
      
      if (!response.ok) {
        console.error('API keys check failed with status:', response.status);
        router.push('/dashboard');
        return;
      }
      
      const data = (await response.json()) as { data?: { claude_validated?: boolean; tavily_validated?: boolean; dataforseo_validated?: boolean } };
      
      const hasRequiredKeys = data.data?.claude_validated && 
                       data.data?.tavily_validated;
      
      if (!hasRequiredKeys) {
        router.push('/dashboard');
        return;
      }

      setValidatedKeys({
        claude: !!data.data?.claude_validated,
        tavily: !!data.data?.tavily_validated,
        dataforseo: !!data.data?.dataforseo_validated,
      });
    } catch (error) {
      console.error('Error checking API keys:', error);
      router.push('/dashboard');
      return;
    }
    
    setLoading(false);
  }
  
  async function fetchFieldLimits() {
    try {
      const response = await fetch('/api/admin/field-limits');
      const data = (await response.json()) as { limits?: { services: number; targetAudience: number; industry: number; location: number } };
      
      if (data.limits) {
        setFieldLimits(data.limits);
        console.log('Field limits loaded:', data.limits);
      }
    } catch (error) {
      console.error('Error fetching field limits:', error);
    }
  }

  function canSelectTier(tier: Tier): boolean {
    if (tier === 'basic') return true;
    // Intermediate and Advanced require DataForSEO
    return validatedKeys.dataforseo;
  }
  
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!canSelectTier(formData.tier)) {
      setError('Selected tier requires DataForSEO credentials. Please configure them in the Dashboard.');
      return;
    }

    setShowConfirmModal(true);
  }

  async function confirmAndSubmit() {
    setShowConfirmModal(false);
    setGenerating(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const sessionResponse = await fetch('/api/sessions/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: session.user.id,
          tier: formData.tier,
          businessName: formData.businessName,
          industry: formData.industry,
          services: formData.services.join(', '),
          additionalServices: formData.additionalServices.join(', '),
          location: formData.location,
          targetAudience: formData.targetAudience,
          uniqueSellingPoints: formData.uniqueSellingPoints,
          contactEmail: formData.contactEmail,
          projectType: formData.projectType,
          brandColors: formData.brandColors,

          businessType: formData.businessType,
          primaryService: formData.services[0] || formData.businessType,
          city: formData.city,
          state: formData.state,
          phoneNumber: formData.phoneNumber,
          streetAddress: formData.streetAddress,
          zipCode: formData.zipCode,
          operatingHours: formData.operatingHours,
          hasBrandColors: formData.hasBrandColors,
          brandColorsArray: formData.brandColorsArray.filter(c => c.trim() !== ''),
          hasBrandFonts: formData.hasBrandFonts,
          brandFontsArray: formData.brandFontsArray.filter(f => f.trim() !== ''),
          yearsInBusiness: formData.yearsInBusiness,
          licenseNumber: formData.licenseNumber,
          googleBusinessUrl: formData.googleBusinessUrl,

          serviceAreaCities: formData.serviceAreaCities.filter(c => c.trim() !== ''),

          ...(formData.tier !== 'basic' && {
            websiteUrl: formData.websiteUrl,
            competitorDomains: formData.competitorDomains.filter(c => c.trim() !== ''),
            targetCustomerType: formData.targetCustomerType,
            brandKeywords: formData.brandKeywords.filter(k => k.trim() !== ''),
            certifications: formData.certifications.filter(c => c.trim() !== ''),
          }),
        })
      });

      const sessionData = (await sessionResponse.json()) as { session?: { id: string }; queued?: boolean; error?: string; details?: string; hint?: string };

      if (!sessionResponse.ok) {
        const errorMsg = sessionData.details
          ? `${sessionData.error}: ${sessionData.details}${sessionData.hint ? ` - ${sessionData.hint}` : ''}`
          : sessionData.error || 'Failed to create research session';
        throw new Error(errorMsg);
      }

      const sessionId = sessionData.session!.id;

      // Wipe the saved draft now that we've successfully created a session.
      draft.clear().catch(() => {/* best-effort */});

      if (!sessionData.queued) {
        fetch('/api/research/phase1', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sessionId })
        }).catch(err => {
          console.error('Failed to trigger Phase 1:', err);
        });
      }

      router.push(`/research/${sessionId}`);

    } catch (err: any) {
      console.error('Generation error:', err);
      setError(err.message || 'Failed to start research. Please try again.');
      setGenerating(false);
    }
  }

  // ---- Multi-input helpers ----

  function addMultiInputItem(field: 'serviceAreaCities' | 'competitorDomains' | 'brandKeywords' | 'certifications', max: number) {
    const current = formData[field];
    if (current.length < max) {
      setFormData({ ...formData, [field]: [...current, ''] });
    }
  }

  function updateMultiInputItem(field: 'serviceAreaCities' | 'competitorDomains' | 'brandKeywords' | 'certifications', index: number, value: string) {
    const updated = [...formData[field]];
    updated[index] = value;
    setFormData({ ...formData, [field]: updated });
  }

  function removeMultiInputItem(field: 'serviceAreaCities' | 'competitorDomains' | 'brandKeywords' | 'certifications', index: number) {
    const updated = formData[field].filter((_, i) => i !== index);
    if (updated.length === 0) updated.push('');
    setFormData({ ...formData, [field]: updated });
  }

  const isEnhancedTier = formData.tier !== 'basic';
  
  if (loading) {
    return (
      <FullPageLoading message="Loading your research form…" />
    );
  }

  return (
    <KeyHealthGate tier="basic">
    <div className="min-h-screen py-12 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header with Logo */}
        <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <img 
            src="/rae-logo.svg" 
            alt="RAE Logo"
            className="h-10 w-auto cursor-pointer"
            onClick={() => router.push('/dashboard')}
          />
            <div>
              <h1 className="text-3xl font-bold text-white">Generate Research</h1>
              <p className="text-gray-400 text-sm">
                Fill out the form below to start your AI-powered research
              </p>
            </div>
          </div>
          <Button
            onClick={() => router.push('/dashboard')}
            variant="outline"
            size="sm"
          >
            ← Dashboard
          </Button>
        </div>
        
        {/* Form */}
        <form onSubmit={handleSubmit} className="glass-panel rounded-xl p-8 space-y-8">

          {/* ===== TIER SELECTION ===== */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white border-b border-cyan-electric/30 pb-2">
              Research Tier
            </h2>
            <p className="text-sm text-gray-400">
              Choose the depth of research. Higher tiers require DataForSEO credentials.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(Object.entries(TIER_INFO) as [Tier, TierInfo][]).map(([key, tier]) => {
                const selectable = canSelectTier(key);
                const selected = formData.tier === key;

                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!selectable}
                    onClick={() => {
                      if (!selectable) return;
                      if (key === 'advanced') {
                        setShowAdvancedWarning(true);
                      } else {
                        setFormData({ ...formData, tier: key });
                      }
                    }}
                    className={`
                      relative flex flex-col items-start text-left p-5 rounded-xl border-2 transition-all duration-200
                      ${selected
                        ? 'border-cyan-electric bg-cyan-electric/10 shadow-glow-cyan'
                        : selectable
                          ? 'border-white/10 bg-navy-dark/70 hover:border-white/30 hover:bg-navy-dark/90'
                          : 'border-white/5 bg-navy-dark/30 opacity-50 cursor-not-allowed'
                      }
                    `}
                  >
                    {/* Most Popular badge for Intermediate */}
                    {key === 'intermediate' && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-cyan-electric to-blue-500 text-white text-xs font-bold shadow-lg whitespace-nowrap z-10">
                        ⭐ MOST POPULAR
                      </div>
                    )}

                    {/* Established Sites Only badge for Advanced */}
                    {key === 'advanced' && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-orange-500/90 text-white text-xs font-semibold shadow-lg whitespace-nowrap z-10">
                        ⚠️ Established Sites Only
                      </div>
                    )}

                    {/* Selected indicator */}
                    {selected && (
                      <div className="absolute top-3 right-3 w-3 h-3 rounded-full bg-cyan-electric animate-pulse" />
                    )}

                    <div className="space-y-3">
                      <div>
                        <h3 className={`text-lg font-bold ${selected ? 'text-cyan-electric' : 'text-white'}`}>
                          {tier.label}
                        </h3>
                        <p className="text-xs text-gray-400 mt-1">{tier.description}</p>
                      </div>

                      <ul className="space-y-1">
                        {(expandedTiers[key] ? tier.features : tier.features.slice(0, 5)).map((feature, i) => (
                          <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                            <span className="text-cyan-electric mt-0.5 flex-shrink-0">✓</span>
                            <span>{feature}</span>
                          </li>
                        ))}
                        {tier.features.length > 5 && (
                          <li 
                            className="text-xs text-cyan-electric pl-4 cursor-pointer hover:text-cyan-400 transition-colors flex items-center gap-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedTiers({ ...expandedTiers, [key]: !expandedTiers[key] });
                            }}
                          >
                            <span>{expandedTiers[key] ? '−' : '+'}{expandedTiers[key] ? 'Show less' : `${tier.features.length - 5} more`}</span>
                          </li>
                        )}
                      </ul>

                      <div className="pt-2 border-t border-white/10 space-y-1">
                        <p className="text-xs text-gray-400">
                          <span className="font-medium text-gray-300">Cost:</span> {tier.estimatedCost}
                        </p>
                        <p className="text-xs text-gray-400">
                          <span className="font-medium text-gray-300">Time:</span> {tier.estimatedTime}
                        </p>
                        <p className="text-xs text-gray-400">
                          <span className="font-medium text-gray-300">Keys:</span>{' '}
                          {tier.requiredKeys.map((k, i) => (
                            <span key={k}>
                              <span className={
                                (k === 'Claude' && validatedKeys.claude) ||
                                (k === 'Tavily' && validatedKeys.tavily) ||
                                (k === 'DataForSEO' && validatedKeys.dataforseo)
                                  ? 'text-green-400'
                                  : 'text-red-400'
                              }>
                                {k}
                              </span>
                              {i < tier.requiredKeys.length - 1 && ', '}
                            </span>
                          ))}
                        </p>
                      </div>

                      {!selectable && (
                        <p className="text-xs text-orange-400 mt-1">
                          ⚠ DataForSEO credentials required.{' '}
                          <span
                            className="underline cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push('/dashboard');
                            }}
                          >
                            Configure in Dashboard
                          </span>
                        </p>
                      )}

                      {tier.warning && selectable && selected && (
                        <p className="text-xs text-orange-400 mt-1">
                          ⚠ {tier.warning}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          
          {/* ===== BUSINESS INFORMATION ===== */}
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white border-b border-cyan-electric/30 pb-2">Business Information</h2>
            
            {/* Business Name */}
            <div>
              <label htmlFor="businessName" className="block text-sm font-medium text-gray-300 mb-2">
                Business Name (as registered) <span className="text-cyan-electric">*</span>
              </label>
              <Input
                id="businessName"
                value={formData.businessName}
                onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                placeholder="e.g., Smith & Associates"
                required
              />
            </div>
            
            {/* Type of Business */}
            <div>
              <label htmlFor="businessType" className="block text-sm font-medium text-gray-300 mb-2">
                Type of Business <span className="text-cyan-electric">*</span>
              </label>
              <Input
                id="businessType"
                value={formData.businessType}
                onChange={(e) => setFormData({ ...formData, businessType: e.target.value, industry: e.target.value })}
                placeholder="e.g., Plumber, Electrician, Legal Services, Real Estate"
                required
              />
            </div>
            
            {/* Website URL — optional for all tiers */}
            <div>
              <label htmlFor="websiteUrl" className="block text-sm font-medium text-gray-300 mb-2">
                Website URL <span className="text-xs text-gray-400">(Optional)</span>
              </label>
              <Input
                id="websiteUrl"
                type="url"
                value={formData.websiteUrl}
                onChange={(e) => setFormData({ ...formData, websiteUrl: e.target.value })}
                placeholder="https://www.yourbusiness.com"
                required={false}
              />
              <p className="text-xs text-gray-400 mt-1">
                {formData.tier === 'basic' 
                  ? 'If you already have a website, we can analyze it to understand how your new site will differ. Leave blank if you don\'t have one yet.'
                  : 'Recommended: Provides domain rank analysis, Lighthouse audits, keyword discovery, on-page crawl' + (formData.tier === 'advanced' ? ', and backlink profile analysis' : '') + '. Leave blank if you don\'t have a website yet.'
                }
              </p>
            </div>
          </div>
          
          {/* ===== SERVICE LOCATION ===== */}
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white border-b border-cyan-electric/30 pb-2">Service Location</h2>
            
            {/* City */}
            <div>
              <label htmlFor="city" className="block text-sm font-medium text-gray-300 mb-2">
                City Where You Operate <span className="text-cyan-electric">*</span>
              </label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value, location: e.target.value + (formData.state ? ', ' + formData.state : '') })}
                placeholder="e.g., Austin"
                required
              />
            </div>
            
            {/* State */}
            <div>
              <label htmlFor="state" className="block text-sm font-medium text-gray-300 mb-2">
                State <span className="text-cyan-electric">*</span>
              </label>
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value, location: formData.city + (e.target.value ? ', ' + e.target.value : '') })}
                placeholder="e.g., Texas or TX"
                required
              />
            </div>
            
            {/* Business Street Address */}
            <div>
              <label htmlFor="streetAddress" className="block text-sm font-medium text-gray-300 mb-2">
                Business Street Address (Optional)
              </label>
              <Input
                id="streetAddress"
                value={formData.streetAddress}
                onChange={(e) => setFormData({ ...formData, streetAddress: e.target.value })}
                placeholder="123 Main Street"
              />
              <p className="text-xs text-gray-400 mt-1">
                Leave blank if you're a service area business without a physical storefront
              </p>
            </div>
            
            {/* ZIP Code */}
            <div>
              <label htmlFor="zipCode" className="block text-sm font-medium text-gray-300 mb-2">
                ZIP Code <span className="text-cyan-electric">*</span>
              </label>
              <Input
                id="zipCode"
                value={formData.zipCode}
                onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                placeholder="78701"
                required
              />
            </div>
            
            {/* Additional Service Area Cities */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Additional Service Area Cities (Optional, up to 10)
              </label>
              <p className="text-xs text-gray-400 mb-3">
                Add other cities you service for location-specific keyword data and SERP analysis.
              </p>
              {formData.serviceAreaCities.map((city, index) => (
                <div key={index} className="flex items-center gap-2 mb-2">
                  <CityAutocomplete
                    value={city}
                    onChange={(val) => updateMultiInputItem('serviceAreaCities', index, val)}
                    placeholder="e.g., Grand Blanc, MI"
                    className="flex-1"
                  />
                  {formData.serviceAreaCities.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeMultiInputItem('serviceAreaCities', index)}
                      className="text-red-400 hover:text-red-300 text-sm px-2 py-1"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {formData.serviceAreaCities.length < 10 && (
                <button
                  type="button"
                  onClick={() => addMultiInputItem('serviceAreaCities', 10)}
                  className="text-xs text-cyan-electric hover:text-cyan-300 mt-1"
                >
                  + Add another city
                </button>
              )}
            </div>
          </div>
          
          {/* ===== CONTACT INFORMATION ===== */}
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white border-b border-cyan-electric/30 pb-2">Contact Information</h2>
            
            {/* Business Phone */}
            <div>
              <label htmlFor="phoneNumber" className="block text-sm font-medium text-gray-300 mb-2">
                Business Phone Number <span className="text-cyan-electric">*</span>
              </label>
              <Input
                id="phoneNumber"
                type="tel"
                value={formData.phoneNumber}
                onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                placeholder="(555) 555-5555"
                required
              />
            </div>
            
            {/* Contact Email */}
            <div>
              <label htmlFor="contactEmail" className="block text-sm font-medium text-gray-300 mb-2">
                Contact Email
              </label>
              <Input
                id="contactEmail"
                type="email"
                value={formData.contactEmail}
                onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                placeholder="contact@business.com"
              />
            </div>
            
            {/* Google Business Profile URL */}
            <div>
              <label htmlFor="googleBusinessUrl" className="block text-sm font-medium text-gray-300 mb-2">
                Google Business Profile URL (Optional)
                <span className="ml-2 text-xs text-cyan-electric">⭐ Recommended for enhanced analysis</span>
              </label>
              <Input
                id="googleBusinessUrl"
                type="url"
                value={formData.googleBusinessUrl}
                onChange={(e) => setFormData({ ...formData, googleBusinessUrl: e.target.value })}
                placeholder="https://www.google.com/maps/place/..."
              />
              <p className="text-xs text-gray-400 mt-1">
                📍 If you have a Google Business Profile, paste the URL here. We'll compare your profile against competitors and provide personalized recommendations.
              </p>
              <details className="mt-2">
                <summary className="text-xs text-cyan-electric cursor-pointer hover:text-cyan-300">
                  How do I find my Google Business Profile URL?
                </summary>
                <div className="text-xs text-gray-400 mt-2 pl-4 border-l-2 border-cyan-electric/30">
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Search for your business name on Google Maps</li>
                    <li>Click on your business listing</li>
                    <li>Click the "Share" button</li>
                    <li>Copy the link and paste it here</li>
                  </ol>
                  <p className="mt-2 italic">Example: https://www.google.com/maps/place/Your+Business+Name/@...</p>
                </div>
              </details>
            </div>
          </div>
          
          {/* ===== HOURS & OPERATIONS ===== */}
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white border-b border-cyan-electric/30 pb-2">Hours & Operations</h2>
            
            {/* Operating Hours */}
            <div>
              <label htmlFor="operatingHours" className="block text-sm font-medium text-gray-300 mb-2">
                Operating Hours
              </label>
              <Input
                id="operatingHours"
                value={formData.operatingHours}
                onChange={(e) => setFormData({ ...formData, operatingHours: e.target.value })}
                placeholder='e.g., "Monday-Friday, 8 AM - 5 PM" or "24/7 Emergency Services"'
              />
            </div>
          </div>
          
          {/* ===== BRANDING ===== */}
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white border-b border-cyan-electric/30 pb-2">Branding</h2>
            
            {/* Has Brand Colors Toggle */}
            <div>
              <label className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.hasBrandColors}
                  onChange={(e) => setFormData({ ...formData, hasBrandColors: e.target.checked })}
                  className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-300">
                  I have established brand colors
                </span>
              </label>
              <p className="text-xs text-gray-400 mt-1 ml-8">
                If No: We'll use a professional default
              </p>
            </div>
            
            {/* Brand Colors (if yes) */}
            {formData.hasBrandColors && (
              <div className="ml-8 space-y-3">
                <label className="block text-sm font-medium text-gray-300">
                  Brand Colors
                </label>
                {formData.brandColorsArray.map((color, index) => (
                  <BrandColorRow
                    key={index}
                    index={index}
                    color={color}
                    totalColors={formData.brandColorsArray.length}
                    canAdd={formData.brandColorsArray.length < 5}
                    onColorChange={(hex) => {
                      const newColors = [...formData.brandColorsArray];
                      newColors[index] = hex;
                      setFormData({ ...formData, brandColorsArray: newColors });
                    }}
                    onAdd={() => setFormData({ ...formData, brandColorsArray: [...formData.brandColorsArray, ''] })}
                    onRemove={() => {
                      const newColors = formData.brandColorsArray.filter((_, i) => i !== index);
                      setFormData({ ...formData, brandColorsArray: newColors });
                    }}
                  />
                ))}
                <p className="text-xs text-gray-400">
                  Click the swatch for the color picker (includes dropper in Chrome/Edge) or enter a hex code. Add up to 5 colors.
                </p>
              </div>
            )}

            {/* Brand Fonts (optional) */}
            <div className="flex items-start gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.hasBrandFonts}
                  onChange={(e) => setFormData({ ...formData, hasBrandFonts: e.target.checked })}
                  className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-300">
                  I have brand fonts to use
                </span>
              </label>
              <p className="text-xs text-gray-400 mt-0.5">
                e.g. Google Fonts names (Inter, Poppins)
              </p>
            </div>
            {formData.hasBrandFonts && (
              <div className="ml-8 space-y-3">
                <label className="block text-sm font-medium text-gray-300">
                  Brand Fonts
                </label>
                {formData.brandFontsArray.map((font, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={font}
                      onChange={(e) => {
                        const newFonts = [...formData.brandFontsArray];
                        newFonts[index] = e.target.value;
                        setFormData({ ...formData, brandFontsArray: newFonts });
                      }}
                      placeholder="e.g., Inter, Poppins"
                      className="flex-1"
                    />
                    {index === formData.brandFontsArray.length - 1 && formData.brandFontsArray.length < 5 && (
                      <Button
                        type="button"
                        onClick={() => setFormData({ ...formData, brandFontsArray: [...formData.brandFontsArray, ''] })}
                        className="px-4 py-2"
                      >
                        + Add Font
                      </Button>
                    )}
                    {formData.brandFontsArray.length > 1 && (
                      <Button
                        type="button"
                        onClick={() => {
                          const newFonts = formData.brandFontsArray.filter((_, i) => i !== index);
                          setFormData({ ...formData, brandFontsArray: newFonts });
                        }}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700"
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                ))}
                <p className="text-xs text-gray-400">
                  Example: Inter, Poppins, Roboto. Add up to 5. These will be passed to the UI design and Cursor prompt.
                </p>
              </div>
            )}
            
            {/* Years in Business */}
            <div>
              <label htmlFor="yearsInBusiness" className="block text-sm font-medium text-gray-300 mb-2">
                Years in Business (optional)
              </label>
              <Input
                id="yearsInBusiness"
                value={formData.yearsInBusiness}
                onChange={(e) => setFormData({ ...formData, yearsInBusiness: e.target.value })}
                placeholder='Example: "Since 2005" or "20"'
              />
            </div>
            
            {/* License Number */}
            <div>
              <label htmlFor="licenseNumber" className="block text-sm font-medium text-gray-300 mb-2">
                License Number (optional)
              </label>
              <Input
                id="licenseNumber"
                value={formData.licenseNumber}
                onChange={(e) => setFormData({ ...formData, licenseNumber: e.target.value })}
                placeholder='Example: "CO Plumbing License #12345"'
              />
            </div>
          </div>
          
          {/* ===== SERVICES OFFERED ===== */}
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white border-b border-cyan-electric/30 pb-2">Services Offered</h2>
            
            {/* Primary Services */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Primary Services <span className="text-cyan-electric">*</span>
                <span className="text-xs text-gray-400 ml-2">
                  ({formData.services.length}/6 selected)
                </span>
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Select up to 6 of your most important services. The first selected service is used as your primary service for keyword research.
              </p>
              <ServiceSelector
                selected={formData.services}
                onChange={(services) => setFormData({ ...formData, services })}
                maxSelections={6}
                excludeServices={formData.additionalServices}
              />
            </div>

            {/* Additional Services */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Additional Services (optional)
                {formData.additionalServices.length > 0 && (
                  <span className="text-xs text-gray-400 ml-2">
                    ({formData.additionalServices.length} selected)
                  </span>
                )}
              </label>
              <p className="text-xs text-gray-500 mb-2">
                These will be included in your final report and build prompts but not in web research.
              </p>
              <ServiceSelector
                selected={formData.additionalServices}
                onChange={(additionalServices) => setFormData({ ...formData, additionalServices })}
                excludeServices={formData.services}
              />
            </div>
            
            {/* Target Audience */}
            <div>
              <label htmlFor="targetAudience" className="block text-sm font-medium text-gray-300 mb-2">
                Target Audience
                <span className="text-xs text-gray-400 ml-2">
                  ({formData.targetAudience?.length || 0}/{fieldLimits.targetAudience} characters)
                </span>
              </label>
              <textarea
                id="targetAudience"
                value={formData.targetAudience}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value.length <= fieldLimits.targetAudience) {
                    setFormData({ ...formData, targetAudience: value });
                  }
                }}
                placeholder="e.g., Homeowners, small business owners, property managers"
                rows={3}
                maxLength={fieldLimits.targetAudience}
                className="w-full px-4 py-3 border border-white/10 bg-navy-dark/70 backdrop-blur-sm rounded-lg focus:ring-2 focus:ring-cyan-electric focus:border-cyan-electric focus:shadow-glow-cyan outline-none transition text-white"
              />
              {formData.targetAudience && formData.targetAudience.length > fieldLimits.targetAudience * 0.9 && (
                <p className="text-xs text-yellow-400 mt-1">
                  {fieldLimits.targetAudience - (formData.targetAudience?.length || 0)} characters remaining
                </p>
              )}
            </div>

            {/* Target Customer Type — shown for Intermediate/Advanced */}
            {isEnhancedTier && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Target Customer Type
                </label>
                <div className="flex gap-4">
                  {(['residential', 'commercial', 'both'] as const).map((type) => (
                    <label key={type} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="targetCustomerType"
                        value={type}
                        checked={formData.targetCustomerType === type}
                        onChange={(e) => setFormData({ ...formData, targetCustomerType: e.target.value as any })}
                        className="text-cyan-electric focus:ring-cyan-electric"
                      />
                      <span className="text-sm text-gray-300 capitalize">{type}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            
            {/* Unique Selling Points */}
            <div>
              <label htmlFor="uniqueSellingPoints" className="block text-sm font-medium text-gray-300 mb-2">
                Unique Selling Points
              </label>
              <textarea
                id="uniqueSellingPoints"
                value={formData.uniqueSellingPoints}
                onChange={(e) => setFormData({ ...formData, uniqueSellingPoints: e.target.value })}
                placeholder="e.g., 20+ years experience, personalized service, affordable rates, 24/7 availability"
                rows={3}
                className="w-full px-4 py-3 border border-white/10 bg-navy-dark/70 backdrop-blur-sm rounded-lg focus:ring-2 focus:ring-cyan-electric focus:border-cyan-electric focus:shadow-glow-cyan outline-none transition text-white"
              />
            </div>
          </div>

          {/* ===== COMPETITIVE INTELLIGENCE (Intermediate/Advanced) ===== */}
          {isEnhancedTier && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-white border-b border-cyan-electric/30 pb-2">
                Competitive Intelligence
                <span className="ml-2 text-xs text-cyan-electric font-normal">Enhanced tiers</span>
              </h2>
              <p className="text-sm text-gray-400">
                Optional: Provide known competitors and brand terms for deeper analysis.
              </p>

              {/* Competitor Domains */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Known Competitor Domains (up to 5)
                </label>
                <p className="text-xs text-gray-400 mb-3">
                  Add competitor website domains for domain intersection and keyword gap analysis.
                </p>
                {formData.competitorDomains.map((domain, index) => (
                  <div key={index} className="flex items-center gap-2 mb-2">
                    <Input
                      value={domain}
                      onChange={(e) => updateMultiInputItem('competitorDomains', index, e.target.value)}
                      placeholder="e.g., competitorbusiness.com"
                      className="flex-1"
                    />
                    {formData.competitorDomains.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMultiInputItem('competitorDomains', index)}
                        className="text-red-400 hover:text-red-300 text-sm px-2 py-1"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {formData.competitorDomains.length < 5 && (
                  <button
                    type="button"
                    onClick={() => addMultiInputItem('competitorDomains', 5)}
                    className="text-xs text-cyan-electric hover:text-cyan-300 mt-1"
                  >
                    + Add competitor
                  </button>
                )}
              </div>

              {/* Brand Keywords */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Brand Keywords (Optional)
                </label>
                <p className="text-xs text-gray-400 mb-3">
                  Your brand name variations and branded search terms to track.
                </p>
                {formData.brandKeywords.map((keyword, index) => (
                  <div key={index} className="flex items-center gap-2 mb-2">
                    <Input
                      value={keyword}
                      onChange={(e) => updateMultiInputItem('brandKeywords', index, e.target.value)}
                      placeholder={`e.g., "${formData.businessName || 'Your Brand'}" or "Smith Plumbing"`}
                      className="flex-1"
                    />
                    {formData.brandKeywords.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMultiInputItem('brandKeywords', index)}
                        className="text-red-400 hover:text-red-300 text-sm px-2 py-1"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {formData.brandKeywords.length < 10 && (
                  <button
                    type="button"
                    onClick={() => addMultiInputItem('brandKeywords', 10)}
                    className="text-xs text-cyan-electric hover:text-cyan-300 mt-1"
                  >
                    + Add keyword
                  </button>
                )}
              </div>

              {/* Certifications */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Certifications & Accreditations (Optional)
                </label>
                <p className="text-xs text-gray-400 mb-3">
                  Professional certifications, licenses, or accreditations for trust signals.
                </p>
                {formData.certifications.map((cert, index) => (
                  <div key={index} className="flex items-center gap-2 mb-2">
                    <Input
                      value={cert}
                      onChange={(e) => updateMultiInputItem('certifications', index, e.target.value)}
                      placeholder='e.g., "EPA Lead-Safe Certified" or "BBB A+ Rating"'
                      className="flex-1"
                    />
                    {formData.certifications.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMultiInputItem('certifications', index)}
                        className="text-red-400 hover:text-red-300 text-sm px-2 py-1"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {formData.certifications.length < 10 && (
                  <button
                    type="button"
                    onClick={() => addMultiInputItem('certifications', 10)}
                    className="text-xs text-cyan-electric hover:text-cyan-300 mt-1"
                  >
                    + Add certification
                  </button>
                )}
              </div>
            </div>
          )}
          
          {error && (
            <div className="glass-panel-dark border border-red-500/30 rounded-lg p-4 bg-navy-dark/95">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
          
          {/* Submit Button */}
          <Button
            type="submit"
            disabled={generating}
            className="w-full"
            size="lg"
          >
            {generating ? (
              <span className="flex items-center justify-center">
                <InlineSpinner className="mr-3" />
                Starting Research... (Redirecting to progress page)
              </span>
            ) : (
              `Start ${formData.tier === 'basic' ? '4-Phase' : formData.tier === 'intermediate' ? '10-Phase' : '10-Phase Advanced'} Research`
            )}
          </Button>
          
          <p className="text-xs text-gray-400 text-center">
            {formData.tier === 'basic' ? (
              <>
                This will use your Claude and Tavily API keys to generate comprehensive 4-phase research. Estimated time: 10–20 minutes.
              </>
            ) : (
              <>
                This will use your Claude, Tavily, and DataForSEO API keys for a comprehensive {formData.tier === 'advanced' ? '10-phase advanced' : '10-phase'} SEO audit.
                Estimated DataForSEO cost: {TIER_INFO[formData.tier].estimatedCost}. Estimated time: {TIER_INFO[formData.tier].estimatedTime}.
              </>
            )}
          </p>
        </form>
      </div>

      {showConfirmModal && (
        <ResearchConfirmationModal
          tier={formData.tier}
          onConfirm={confirmAndSubmit}
          onCancel={() => setShowConfirmModal(false)}
        />
      )}

      {showAdvancedWarning && (
        <AdvancedTierWarningModal
          onChooseIntermediate={() => {
            setFormData({ ...formData, tier: 'intermediate' });
            setShowAdvancedWarning(false);
          }}
          onContinueAdvanced={() => {
            setFormData({ ...formData, tier: 'advanced' });
            setShowAdvancedWarning(false);
          }}
        />
      )}
    </div>
    </KeyHealthGate>
  );
}
