'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase-client';

interface MultiApiKeySetupProps {
  onComplete: () => void;
  isUpdating?: boolean; // If true, user is updating existing keys (not first-time setup)
}

interface ExpandableGuideProps {
  title: string;
  icon: string;
  borderColor: string;
  bgColor: string;
  hoverColor: string;
  textColor: string;
  children: React.ReactNode;
}

function ExpandableGuide({ title, icon, borderColor, bgColor, hoverColor, textColor, children }: ExpandableGuideProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border border-white/10 rounded-lg overflow-hidden transition-all bg-navy-dark/50 backdrop-blur-sm">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full hover:bg-white/5 p-4 flex items-center justify-between transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{icon}</span>
          <h4 className="font-semibold text-white">{title}</h4>
        </div>
        <svg
          className={`w-5 h-5 text-cyan-electric transform transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {isOpen && (
        <div className="p-4 bg-navy-deep/50 border-t border-white/10 animate-in slide-in-from-top-2 duration-200">
          {children}
        </div>
      )}
    </div>
  );
}

export default function MultiApiKeySetup({ onComplete, isUpdating = false }: MultiApiKeySetupProps) {
  const [apiKeys, setApiKeys] = useState({
    claude: '',
    tavily: '',
    dataforseoLogin: '',
    dataforseoPassword: ''
  });
  
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [validationResults, setValidationResults] = useState<any>(null);
  
  const supabase = createClient();

  async function validateAndSave() {
    if (!apiKeys.claude || !apiKeys.tavily) {
      setError('Claude and Tavily API keys are required');
      return;
    }

    // DataForSEO: if one field is filled, both must be filled
    const hasDataForSEO = apiKeys.dataforseoLogin || apiKeys.dataforseoPassword;
    if (hasDataForSEO && (!apiKeys.dataforseoLogin || !apiKeys.dataforseoPassword)) {
      setError('DataForSEO requires both login and password');
      return;
    }

    setValidating(true);
    setError('');
    setValidationResults(null);

    try {
      // Step 1: Validate all API keys
      const validateBody: any = {
        claudeKey: apiKeys.claude,
        tavilyKey: apiKeys.tavily
      };
      if (apiKeys.dataforseoLogin && apiKeys.dataforseoPassword) {
        validateBody.dataforseoLogin = apiKeys.dataforseoLogin;
        validateBody.dataforseoPassword = apiKeys.dataforseoPassword;
      }

      const validateResponse = await fetch('/api/keys/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validateBody)
      });

      const validateData = (await validateResponse.json()) as {
        error?: string;
        results?: { claude?: { valid?: boolean; error?: string }; tavily?: { valid?: boolean; error?: string }; dataforseo?: { valid?: boolean; error?: string } };
      };
      
      if (!validateResponse.ok) {
        throw new Error(validateData.error || 'Validation failed');
      }

      setValidationResults(validateData.results ?? {});

      // Check if required keys are valid (DataForSEO is optional)
      const requiredValid = validateData.results?.claude?.valid && 
                      validateData.results?.tavily?.valid;

      if (!requiredValid) {
        const errors = [];
        if (!validateData.results?.claude?.valid) {
          errors.push(`Claude: ${validateData.results?.claude?.error ?? ''}`);
        }
        if (!validateData.results?.tavily?.valid) {
          errors.push(`Tavily: ${validateData.results?.tavily?.error ?? ''}`);
        }
        setError(errors.join(' | '));
        setValidating(false);
        return;
      }

      // Check DataForSEO validation if provided
      if (hasDataForSEO && !validateData.results?.dataforseo?.valid) {
        setError(`DataForSEO: ${validateData.results?.dataforseo?.error || 'Invalid credentials'}`);
        setValidating(false);
        return;
      }

      // Step 2: Save encrypted keys to database
      setSaving(true);
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error('Not authenticated');
      }

      const saveBody: any = {
        userId: session.user.id,
        claudeKey: apiKeys.claude,
        tavilyKey: apiKeys.tavily,
        claudeValidated: true,
        tavilyValidated: true
      };
      if (apiKeys.dataforseoLogin && apiKeys.dataforseoPassword) {
        saveBody.dataforseoLogin = apiKeys.dataforseoLogin;
        saveBody.dataforseoPassword = apiKeys.dataforseoPassword;
        saveBody.dataforseoValidated = true;
      }

      const saveResponse = await fetch('/api/keys/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saveBody)
      });

      const saveData = (await saveResponse.json()) as { error?: string; message?: string };

      if (!saveResponse.ok) {
        // Validation failures put the specific reason in `message`
        throw new Error(saveData.message || saveData.error || 'Failed to save API keys');
      }

      // Success!
      onComplete();

    } catch (err: any) {
      setError(err.message || 'Failed to validate and save API keys');
    } finally {
      setValidating(false);
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="max-w-3xl w-full">
        {/* Back Button (when updating existing keys) */}
        {isUpdating && (
          <div className="mb-4 flex justify-end">
            <Button onClick={onComplete} variant="outline">
              Back to Dashboard
            </Button>
          </div>
        )}
        
        <Card>
          <CardHeader>
            <CardTitle>{isUpdating ? 'Manage Your API Keys' : 'Set Up Your API Keys'}</CardTitle>
            <CardDescription>
              The 4-Phase Research Engine requires API keys from Claude and Tavily.
              Your keys are encrypted and stored securely.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Claude API Key */}
            <div className="space-y-2">
              <label htmlFor="claude-key" className="block text-sm font-medium text-gray-300">
                Claude API Key
                <span className="ml-2 text-xs text-gray-400">(Used for final synthesis & prompt generation in Phase 4)</span>
              </label>
              <Input
                id="claude-key"
                type="password"
                value={apiKeys.claude}
                onChange={(e) => setApiKeys({ ...apiKeys, claude: e.target.value })}
                placeholder="sk-ant-..."
                className="font-mono text-sm"
              />
              <p className="text-xs text-gray-400">
                Get your key at: <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">console.anthropic.com</a>
              </p>
              {validationResults?.claude && (
                <p className={`text-xs ${validationResults.claude.valid ? 'text-cyan-electric' : 'text-red-400'}`}>
                  {validationResults.claude.valid ? '✓ Valid' : `✗ ${validationResults.claude.error}`}
                </p>
              )}
            </div>

            {/* Tavily API Key */}
            <div className="space-y-2">
              <label htmlFor="tavily-key" className="block text-sm font-medium text-gray-300">
                Tavily API Key
                <span className="ml-2 text-xs text-gray-400">(Used for web research in Phases 1-3)</span>
              </label>
              <Input
                id="tavily-key"
                type="password"
                value={apiKeys.tavily}
                onChange={(e) => setApiKeys({ ...apiKeys, tavily: e.target.value })}
                placeholder="tvly-..."
                className="font-mono text-sm"
              />
              <p className="text-xs text-gray-400">
                Get your key at: <a href="https://app.tavily.com" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">app.tavily.com</a>
              </p>
              {validationResults?.tavily && (
                <p className={`text-xs ${validationResults.tavily.valid ? 'text-cyan-electric' : 'text-red-400'}`}>
                  {validationResults.tavily.valid ? '✓ Valid' : `✗ ${validationResults.tavily.error}`}
                </p>
              )}
            </div>

            {/* DataForSEO Credentials (Optional) */}
            <div className="space-y-2 border border-cyan-electric/20 rounded-lg p-4 bg-cyan-electric/5">
              <div className="flex items-center gap-2 mb-2">
                <label className="block text-sm font-medium text-gray-300">
                  DataForSEO Credentials
                </label>
                <span className="px-2 py-0.5 text-xs font-semibold bg-cyan-electric/20 text-cyan-electric rounded-full border border-cyan-electric/30">
                  OPTIONAL — Enhanced SEO Data
                </span>
              </div>
              <p className="text-xs text-gray-400 mb-3">
                Add DataForSEO credentials to supercharge your research with real SEO data: local competitor analysis, keyword metrics, and on-page technical audits.
              </p>
              <div className="space-y-3">
                <div>
                  <label htmlFor="dataforseo-login" className="block text-xs font-medium text-gray-400 mb-1">
                    DataForSEO Login (Email)
                  </label>
                  <Input
                    id="dataforseo-login"
                    type="text"
                    value={apiKeys.dataforseoLogin}
                    onChange={(e) => setApiKeys({ ...apiKeys, dataforseoLogin: e.target.value })}
                    placeholder="your@email.com"
                    className="font-mono text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="dataforseo-password" className="block text-xs font-medium text-gray-400 mb-1">
                    DataForSEO Password
                  </label>
                  <Input
                    id="dataforseo-password"
                    type="password"
                    value={apiKeys.dataforseoPassword}
                    onChange={(e) => setApiKeys({ ...apiKeys, dataforseoPassword: e.target.value })}
                    placeholder="Your API password"
                    className="font-mono text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Get your credentials at: <a href="https://app.dataforseo.com/api-access" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">app.dataforseo.com</a>
              </p>
              {validationResults?.dataforseo && (
                <p className={`text-xs ${validationResults.dataforseo.valid ? 'text-cyan-electric' : 'text-red-400'}`}>
                  {validationResults.dataforseo.valid 
                    ? `✓ Valid (Balance: $${validationResults.dataforseo.balance?.toFixed(2) || '0.00'})` 
                    : `✗ ${validationResults.dataforseo.error}`}
                </p>
              )}
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 backdrop-blur-sm">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <Button
              onClick={validateAndSave}
              disabled={validating || saving}
              className="w-full"
              size="lg"
            >
              {validating ? 'Validating...' : saving ? 'Saving...' : 'Validate & Save API Keys'}
            </Button>

            {/* Expandable Setup Guides */}
            <div className="border-t border-white/10 pt-6 space-y-4">
              <h3 className="font-semibold mb-3 text-white">📖 Setup Guides</h3>
              <p className="text-sm text-gray-400 mb-4">Click on a guide below for step-by-step instructions:</p>
              
              <div className="space-y-3">
                {/* Claude Guide */}
                <ExpandableGuide
                  title="📘 How to Get Your Claude API Key (5 minutes)"
                  icon="🔵"
                  borderColor="border-blue-200"
                  bgColor="bg-blue-50"
                  hoverColor="hover:bg-blue-100"
                  textColor="text-blue-900"
                >
                  <div className="space-y-5 text-sm text-gray-300">
                    <div className="bg-cyan-electric/10 border-l-4 border-cyan-electric p-3 rounded backdrop-blur-sm">
                      <p className="text-sm text-gray-200">
                        <strong className="text-cyan-electric">What is an API Key?</strong> Think of it like a backstage pass that lets the Research Automation Engine use Claude's AI capabilities. You'll set this up once, add a small starting balance, and set a spending limit to stay in control.
                      </p>
                    </div>
                    
                    {/* Step 1 */}
                    <div>
                      <h4 className="font-bold text-white mb-2 text-base">Step 1: Create Your Anthropic Account</h4>
                      <p className="text-gray-400 mb-2 text-xs">⏱️ Time: 2 minutes</p>
                      
                      <div className="space-y-2 ml-3">
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Visit the Anthropic Console</p>
                          <p>Go to: <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 font-medium transition">console.anthropic.com</a></p>
                          <p className="text-xs text-gray-400">Click "Sign Up" (usually in the top right corner)</p>
                        </div>
                        
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Create Your Account</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc space-y-0.5">
                            <li>Enter your email address</li>
                            <li>Create a strong password</li>
                            <li>Accept the terms of service</li>
                            <li>Click "Create Account"</li>
                          </ul>
                        </div>
                        
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Verify Your Email</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc space-y-0.5">
                            <li>Check your inbox for an email from Anthropic</li>
                            <li>Click the verification link</li>
                            <li>You'll be redirected back to the console</li>
                            <li>Your account is now active!</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                    
                    {/* Step 2 */}
                    <div>
                      <h4 className="font-bold text-white mb-2 text-base">Step 2: Set Up Billing (Don't Worry - You're in Control!)</h4>
                      <p className="text-gray-400 mb-2 text-xs">⏱️ Time: 2 minutes</p>
                      
                      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-3 backdrop-blur-sm">
                        <p className="text-xs text-yellow-200">
                          <strong>💰 Why Billing First?</strong> You need to add a payment method before you can use the API. Think of this like putting $5 in a parking meter - you pay as you go, and we'll set a limit so you never spend more than you want.
                        </p>
                      </div>
                      
                      <div className="space-y-2 ml-3">
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Navigate to Billing</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>In the Anthropic Console, find "Billing" in the left sidebar</li>
                            <li>Or click your profile and select "Billing" or "Plans"</li>
                          </ul>
                        </div>
                        
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Add a Payment Method</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>Click "Add Payment Method"</li>
                            <li>Enter your credit or debit card information</li>
                            <li>Click "Save"</li>
                          </ul>
                        </div>
                        
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Add Your Starting Balance ($5 Minimum)</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>Look for "Add Credits" or "Purchase Credits"</li>
                            <li>Enter $5 (this is the minimum to get started)</li>
                            <li>Click "Purchase" or "Add Credits"</li>
                          </ul>
                        </div>
                      </div>
                      
                      <div className="mt-2 p-3 bg-cyan-electric/10 rounded-lg border border-cyan-electric/30 backdrop-blur-sm">
                        <p className="text-xs text-cyan-electric font-semibold mb-1">How Much Will This Cost You?</p>
                        <p className="text-xs text-gray-300">A single research report using our research engine will cost you about <strong className="text-cyan-electric">$2.50</strong> in Claude usage.</p>
                      </div>
                    </div>
                    
                    {/* Step 3 */}
                    <div>
                      <h4 className="font-bold text-white mb-2 text-base">Step 3: Set Your Spending Limits (IMPORTANT!)</h4>
                      <p className="text-gray-400 mb-2 text-xs">⏱️ Time: 1 minute</p>
                      
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                        <p className="text-xs text-red-900">
                          <strong>🛡️ This is Your Safety Net</strong> - It prevents any surprise charges. We recommend starting conservative and adjusting up if needed.
                        </p>
                      </div>
                      
                      <div className="space-y-2 ml-3">
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Go to Limits Settings</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>In the left sidebar, click "Settings"</li>
                            <li>Select "Limits" (or find "Usage Limits")</li>
                          </ul>
                        </div>
                        
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Set Your Monthly Spending Limit</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>Find "Monthly Spend Limit" or similar option</li>
                            <li><strong>We recommend starting at: $25/month</strong></li>
                            <li>You can always increase this later if you need more</li>
                          </ul>
                        </div>
                      </div>
                      
                      <div className="mt-2 p-3 bg-navy-deep/50 rounded-lg border border-white/10 backdrop-blur-sm">
                        <p className="text-xs text-gray-700 font-semibold mb-1">Recommended Limits by Usage:</p>
                        <ul className="text-xs text-gray-300 ml-4 list-disc space-y-0.5">
                          <li><strong>Light Use</strong> (5-10 research sessions/month): $10-25/month</li>
                          <li><strong>Regular Use</strong> (20-30 research sessions/month): $50-75/month</li>
                          <li><strong>Heavy Use</strong> (50+ research sessions/month): $125/month</li>
                        </ul>
                      </div>
                    </div>
                    
                    {/* Step 4 */}
                    <div>
                      <h4 className="font-bold text-white mb-2 text-base">Step 4: Create Your API Key</h4>
                      <p className="text-gray-400 mb-2 text-xs">⏱️ Time: 1 minute</p>
                      
                      <div className="space-y-2 ml-3">
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Navigate to API Keys</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>Look for "API Keys" in the left sidebar</li>
                            <li>Or find it under Settings</li>
                          </ul>
                        </div>
                        
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Create a New Key</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>Click "Create Key" or "+ Create API Key"</li>
                            <li>Give it a name (optional): "Research Automation Engine"</li>
                            <li>Select models: Leave default (Claude Sonnet 4.5 is included)</li>
                            <li>Click "Create Key"</li>
                          </ul>
                        </div>
                      </div>
                      
                      <div className="mt-2 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                        <p className="text-xs text-yellow-800">
                          <strong>⚠️ CRITICAL: Copy Your Key IMMEDIATELY</strong><br/>
                          You can only see this key ONCE! It looks like: <code className="bg-yellow-100 px-1 py-0.5 rounded">sk-ant-api03-abc123xyz...</code>
                          <br/>If you lose it, no worries - you'll just need to create a new one.
                        </p>
                      </div>
                    </div>
                    
                    {/* Step 5 */}
                    <div>
                      <h4 className="font-bold text-white mb-2 text-base">Step 5: Add the Key to Research Automation Engine</h4>
                      <p className="text-gray-400 mb-2 text-xs">⏱️ Time: 30 seconds</p>
                      
                      <div className="space-y-2 ml-3">
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Paste Your Key</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>Click in the "Claude API Key" field above</li>
                            <li>Paste your key (Ctrl+V on Windows, Cmd+V on Mac)</li>
                            <li>The key should start with <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">sk-ant-api03-</code></li>
                          </ul>
                        </div>
                        
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Save and Continue</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>Click "Validate & Save API Keys"</li>
                            <li>✅ Done! Your AI research assistant is now connected</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                    
                    {/* Quick Reference */}
                    <div className="pt-3 border-t border-white/10">
                      <p className="text-xs font-semibold text-gray-300 mb-2">🔗 Quick Reference Links:</p>
                        <ul className="text-xs text-gray-400 space-y-1">
                        <li>• <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">Anthropic Console</a></li>
                        <li>• <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">API Keys</a></li>
                        <li>• <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">Billing</a></li>
                        <li>• <a href="https://console.anthropic.com/settings/limits" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">Usage Limits</a></li>
                        <li>• <a href="https://docs.anthropic.com/" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">Documentation</a></li>
                      </ul>
                    </div>
                  </div>
                </ExpandableGuide>

                {/* Tavily Guide */}
                <ExpandableGuide
                  title="📗 How to Get Your Tavily API Key (5 minutes)"
                  icon="🟣"
                  borderColor="border-purple-200"
                  bgColor="bg-purple-50"
                  hoverColor="hover:bg-purple-100"
                  textColor="text-purple-900"
                >
                  <div className="space-y-5 text-sm text-gray-300">
                    <div className="bg-purple-500/10 border-l-4 border-purple-400 p-3 rounded backdrop-blur-sm">
                      <p className="text-sm text-gray-200">
                        <strong>What is an API Key?</strong> Think of it like a password that lets the Research Automation Engine use Tavily's search technology on your behalf. You'll set this up once and forget about it.
                      </p>
                    </div>
                    
                    {/* Step 1 */}
                    <div>
                      <h4 className="font-bold text-white mb-2 text-base">Step 1: Create Your Free Tavily Account</h4>
                      <p className="text-gray-600 mb-2 text-xs">⏱️ Time: 2 minutes</p>
                      
                      <div className="space-y-2 ml-3">
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Go to Tavily's Sign Up Page</p>
                          <p>Visit: <a href="https://tavily.com/" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition font-medium">tavily.com</a></p>
                          <p className="text-xs text-gray-400">Click the "Sign Up" or "Get Started" button (usually in the top right)</p>
                        </div>
                        
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Create Your Account</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc space-y-0.5">
                            <li>Enter your email address</li>
                            <li>Choose a password</li>
                            <li>Click "Sign Up" or "Create Account"</li>
                          </ul>
                          <div className="mt-2 p-2 bg-green-50 rounded border border-green-200">
                            <p className="text-xs text-green-800">
                              🎉 <strong>You'll get 1,000 FREE searches every month</strong> - no credit card required!
                            </p>
                          </div>
                        </div>
                        
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Verify Your Email</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc space-y-0.5">
                            <li>Check your inbox for a verification email from Tavily</li>
                            <li>Click the verification link</li>
                            <li>This usually takes less than a minute</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                    
                    {/* Step 2 */}
                    <div>
                      <h4 className="font-bold text-white mb-2 text-base">Step 2: Get Your API Key</h4>
                      <p className="text-gray-600 mb-2 text-xs">⏱️ Time: 1 minute</p>
                      
                      <div className="space-y-2 ml-3">
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Log Into the Tavily Dashboard</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>Once verified, you'll automatically be logged in</li>
                            <li>If not, go to: <a href="https://app.tavily.com/home" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">app.tavily.com/home</a></li>
                          </ul>
                        </div>
                        
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Find Your API Key</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>Look for the <strong>"API Keys"</strong> section on your dashboard</li>
                            <li>You'll see your key immediately - it looks like: <code className="bg-purple-100 px-1 py-0.5 rounded text-xs">tvly-abc123xyz456...</code></li>
                            <li>Your first API key is automatically created for you!</li>
                          </ul>
                        </div>
                        
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Copy Your Key</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>Click the "Copy" icon next to your API key</li>
                            <li>That's it! Your key is now on your clipboard</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                    
                    {/* Step 3 */}
                    <div>
                      <h4 className="font-bold text-white mb-2 text-base">Step 3: Add the Key to Research Automation Engine</h4>
                      <p className="text-gray-600 mb-2 text-xs">⏱️ Time: 30 seconds</p>
                      
                      <div className="space-y-2 ml-3">
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Paste Your Key</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>Click in the "Tavily API Key" field above</li>
                            <li>Paste your key (Ctrl+V on Windows, Cmd+V on Mac)</li>
                            <li>The key should start with <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">tvly-</code></li>
                          </ul>
                        </div>
                        
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Save and Continue</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>Click "Validate & Save API Keys"</li>
                            <li>✅ Done! Your research engine is now connected to Tavily</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                    
                    {/* Free Plan Info */}
                    <div>
                      <h4 className="font-bold text-white mb-2 text-base">Understanding Your Free Plan</h4>
                      
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-2">
                        <p className="text-xs text-green-900 font-semibold mb-1">What You Get Free:</p>
                        <ul className="text-xs text-green-900 ml-4 list-disc space-y-0.5">
                          <li><strong>1,000 API searches per month</strong></li>
                          <li>Resets on the 1st of each month</li>
                          <li>No credit card required</li>
                          <li>Perfect for most users of Research Automation Engine</li>
                        </ul>
                      </div>
                      
                      <div className="space-y-2 ml-3">
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Monitoring Your Usage:</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>Check your dashboard at any time: <a href="https://app.tavily.com/home" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">app.tavily.com/home</a></li>
                            <li>See exactly how many searches you've used</li>
                            <li>Get notified when you're approaching your limit</li>
                          </ul>
                        </div>
                      </div>
                      
                      <div className="mt-2 p-2 bg-purple-50 rounded-lg border border-purple-200">
                        <p className="text-xs text-purple-800">
                          <strong>💡 Note:</strong> If you find yourself using more than 1,000 searches per month, Tavily offers affordable paid plans. You can upgrade anytime from your dashboard.
                        </p>
                      </div>
                    </div>
                    
                    {/* Troubleshooting */}
                    <div>
                      <h4 className="font-bold text-white mb-2 text-base">Common Questions</h4>
                      
                      <div className="space-y-2 ml-3">
                        <div>
                          <p className="font-semibold text-gray-800 text-xs mb-1">"I can't find my verification email"</p>
                          <ul className="text-xs text-gray-300 ml-4 list-disc">
                            <li>Check your spam/junk folder</li>
                            <li>Add noreply@tavily.com to your contacts</li>
                            <li>Wait a few minutes and try again</li>
                          </ul>
                        </div>
                        
                        <div>
                          <p className="font-semibold text-gray-800 text-xs mb-1">"My API key isn't working"</p>
                          <ul className="text-xs text-gray-300 ml-4 list-disc">
                            <li>Make sure you copied the entire key (starts with tvly-)</li>
                            <li>Check for extra spaces before or after the key</li>
                            <li>Try generating a new key</li>
                          </ul>
                        </div>
                        
                        <div>
                          <p className="font-semibold text-gray-800 text-xs mb-1">"I'm getting rate limit errors"</p>
                          <ul className="text-xs text-gray-300 ml-4 list-disc">
                            <li>You may be close to your 1,000 monthly searches</li>
                            <li>Check your usage in the Tavily dashboard</li>
                            <li>Consider upgrading if you need more searches</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                    
                    {/* Quick Reference */}
                    <div className="pt-3 border-t border-white/10">
                      <p className="text-xs font-semibold text-gray-300 mb-2">🔗 Quick Reference Links:</p>
                        <ul className="text-xs text-gray-400 space-y-1">
                        <li>• <a href="https://tavily.com/" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">Tavily Homepage</a></li>
                        <li>• <a href="https://app.tavily.com/home" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">Dashboard</a></li>
                        <li>• <a href="https://docs.tavily.com/" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">Documentation</a></li>
                      </ul>
                    </div>
                  </div>
                </ExpandableGuide>

                {/* DataForSEO Guide */}
                <ExpandableGuide
                  title="📙 How to Get Your DataForSEO Credentials (5 minutes)"
                  icon="🟠"
                  borderColor="border-orange-200"
                  bgColor="bg-orange-50"
                  hoverColor="hover:bg-orange-100"
                  textColor="text-orange-900"
                >
                  <div className="space-y-5 text-sm text-gray-300">
                    <div className="bg-orange-500/10 border-l-4 border-orange-400 p-3 rounded backdrop-blur-sm">
                      <p className="text-sm text-gray-200">
                        <strong className="text-orange-300">What is DataForSEO?</strong> It&apos;s a professional SEO data provider that supercharges your research with real keyword metrics, local competitor analysis, SERP data, Google Business profiles, reviews, and on-page technical audits. This is <strong>optional</strong> — the basic research works without it.
                      </p>
                    </div>

                    <div className="bg-cyan-electric/10 border border-cyan-electric/30 rounded-lg p-3 backdrop-blur-sm">
                      <p className="text-xs text-cyan-electric font-semibold mb-1">Important: Two Different Passwords</p>
                      <p className="text-xs text-gray-300">
                        DataForSEO uses a separate <strong className="text-white">API password</strong> (auto-generated) that is different from your <strong className="text-white">account password</strong> (the one you create at sign-up). You&apos;ll need the <strong className="text-white">API password</strong> for the Research Automation Engine — not your account login password.
                      </p>
                    </div>

                    {/* Step 1 */}
                    <div>
                      <h4 className="font-bold text-white mb-2 text-base">Step 1: Create Your DataForSEO Account</h4>
                      <p className="text-gray-400 mb-2 text-xs">⏱️ Time: 2 minutes</p>

                      <div className="space-y-2 ml-3">
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Go to the Registration Page</p>
                          <p>Visit: <a href="https://app.dataforseo.com/register" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 font-medium transition">app.dataforseo.com/register</a></p>
                        </div>

                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Create Your Account</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc space-y-0.5">
                            <li>Enter your email address</li>
                            <li>Create a password (this is your <strong>account password</strong> for logging into the dashboard)</li>
                            <li>Click &quot;Register&quot; or &quot;Sign Up&quot;</li>
                          </ul>
                        </div>

                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Verify Your Email</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc space-y-0.5">
                            <li>Check your inbox for a verification email from DataForSEO</li>
                            <li>Click the verification link</li>
                            <li>You&apos;ll be redirected to the DataForSEO Dashboard</li>
                          </ul>
                        </div>

                        <div className="mt-2 p-2 bg-green-500/10 rounded border border-green-500/30 backdrop-blur-sm">
                          <p className="text-xs text-green-300">
                            🎉 <strong>You get $1 free credit upon registration</strong> — enough to test the API and verify your credentials work before adding funds.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div>
                      <h4 className="font-bold text-white mb-2 text-base">Step 2: Add Funds to Your Account</h4>
                      <p className="text-gray-400 mb-2 text-xs">⏱️ Time: 2 minutes</p>

                      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-3 backdrop-blur-sm">
                        <p className="text-xs text-yellow-200">
                          <strong>💰 How It Works:</strong> DataForSEO uses a prepaid balance model — you add funds, and they stay in your account until you use them. There are no recurring charges unless you set up auto-recharge.
                        </p>
                      </div>

                      <div className="space-y-2 ml-3">
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Navigate to Add Funds</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>Log in to the <a href="https://app.dataforseo.com/api-dashboard" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">DataForSEO Dashboard</a></li>
                            <li>Click &quot;Add Funds&quot; (in the top area of your dashboard)</li>
                          </ul>
                        </div>

                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Add Your Starting Balance ($50 Minimum)</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>The minimum deposit is <strong>$50</strong></li>
                            <li>Enter your payment details and confirm</li>
                            <li>Funds are added to your balance immediately</li>
                          </ul>
                        </div>
                      </div>

                      <div className="mt-2 p-3 bg-cyan-electric/10 rounded-lg border border-cyan-electric/30 backdrop-blur-sm">
                        <p className="text-xs text-cyan-electric font-semibold mb-1">How Much Will This Cost You?</p>
                        <p className="text-xs text-gray-300">Each enhanced research session uses approximately <strong className="text-cyan-electric">$0.30 – $0.45</strong> in DataForSEO API calls. A $50 deposit gives you roughly <strong className="text-cyan-electric">100–165 research sessions</strong> before needing to add more funds.</p>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div>
                      <h4 className="font-bold text-white mb-2 text-base">Step 3: Set a Daily Spending Limit (Recommended)</h4>
                      <p className="text-gray-400 mb-2 text-xs">⏱️ Time: 1 minute</p>

                      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3 backdrop-blur-sm">
                        <p className="text-xs text-red-300">
                          <strong>🛡️ This is Your Safety Net</strong> — DataForSEO lets you set a daily spending cap so you never burn through your balance unexpectedly.
                        </p>
                      </div>

                      <div className="space-y-2 ml-3">
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Go to API Settings</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>In the dashboard sidebar, click <a href="https://app.dataforseo.com/api-settings" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">&quot;Settings&quot;</a></li>
                          </ul>
                        </div>

                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Set Your Daily Expenses Limit</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>You can set a <strong>global daily limit</strong> for all APIs</li>
                            <li>Or set a <strong>per-API daily budget</strong> for more control</li>
                            <li><strong>We recommend: $5/day</strong> to start (more than enough for regular research use)</li>
                          </ul>
                        </div>
                      </div>
                    </div>

                    {/* Step 4 */}
                    <div>
                      <h4 className="font-bold text-white mb-2 text-base">Step 4: Get Your API Credentials</h4>
                      <p className="text-gray-400 mb-2 text-xs">⏱️ Time: 1 minute</p>

                      <div className="space-y-2 ml-3">
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Navigate to API Access</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>In the dashboard, click <a href="https://app.dataforseo.com/api-access" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">&quot;API Access&quot;</a> in the left sidebar (or top panel)</li>
                          </ul>
                        </div>

                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Find Your API Login</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>Your <strong>API login</strong> (email) is displayed on the page</li>
                            <li>This is the same email you registered with</li>
                          </ul>
                        </div>

                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Find Your API Password</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>Your <strong>API password</strong> is hidden by default for security</li>
                            <li>It is <strong>visible for the first 24 hours</strong> after registration — copy it now!</li>
                            <li>If you missed it, click <strong>&quot;Send by e-mail&quot;</strong> to have it emailed to you</li>
                          </ul>
                        </div>
                      </div>

                      <div className="mt-2 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30 backdrop-blur-sm">
                        <p className="text-xs text-yellow-200">
                          <strong>⚠️ IMPORTANT: API Password ≠ Account Password</strong><br/>
                          The API password is <strong>auto-generated by DataForSEO</strong> and is different from the password you created during registration. Make sure you copy the <strong>API password</strong> from the API Access page — not your account login password.
                        </p>
                      </div>
                    </div>

                    {/* Step 5 */}
                    <div>
                      <h4 className="font-bold text-white mb-2 text-base">Step 5: Add Credentials to Research Automation Engine</h4>
                      <p className="text-gray-400 mb-2 text-xs">⏱️ Time: 30 seconds</p>

                      <div className="space-y-2 ml-3">
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Enter Your Credentials</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>In the <strong>&quot;DataForSEO Login (Email)&quot;</strong> field above, paste your API login email</li>
                            <li>In the <strong>&quot;DataForSEO Password&quot;</strong> field above, paste your <strong>API password</strong> (not your account password)</li>
                          </ul>
                        </div>

                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Save and Continue</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>Click &quot;Validate & Save API Keys&quot;</li>
                            <li>The system will verify your credentials and show your account balance</li>
                            <li>✅ Done! Your research engine is now supercharged with real SEO data</li>
                          </ul>
                        </div>
                      </div>
                    </div>

                    {/* What You Get */}
                    <div>
                      <h4 className="font-bold text-white mb-2 text-base">What Enhanced SEO Data Unlocks</h4>

                      <div className="bg-cyan-electric/5 border border-cyan-electric/20 rounded-lg p-3 mb-2 backdrop-blur-sm">
                        <p className="text-xs text-gray-200 font-semibold mb-2">Your research reports will include:</p>
                        <ul className="text-xs text-gray-300 ml-4 list-disc space-y-0.5">
                          <li><strong>Real keyword data</strong> — search volume, CPC, difficulty, and intent classification</li>
                          <li><strong>Local competitor analysis</strong> — who ranks in Google Maps, their reviews, GBP profiles</li>
                          <li><strong>SERP analysis</strong> — organic results, paid ads, Local Service Ads, People Also Ask</li>
                          <li><strong>On-page technical audit</strong> — site health, duplicate content, redirects, schema</li>
                          <li><strong>Content opportunities</strong> — related searches, discussions, community sentiment</li>
                        </ul>
                      </div>
                    </div>

                    {/* Monitoring */}
                    <div>
                      <h4 className="font-bold text-white mb-2 text-base">Monitoring Your Usage</h4>

                      <div className="space-y-2 ml-3">
                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Check Your Balance & Spending</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>Balance: visible on the <a href="https://app.dataforseo.com/api-dashboard" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">Dashboard</a></li>
                            <li>Detailed spending per API: <a href="https://app.dataforseo.com/api-detail/serp" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">Usage</a> section</li>
                            <li>Error tracking: <a href="https://app.dataforseo.com/api-errors" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">Errors</a> section</li>
                          </ul>
                        </div>

                        <div>
                          <p className="font-semibold text-gray-200 mb-1">Low Balance Notifications</p>
                          <ul className="text-sm text-gray-300 ml-4 list-disc">
                            <li>DataForSEO will email you when you have 5, 4, 3, 2, and 1 day of balance remaining (based on your average spending)</li>
                          </ul>
                        </div>
                      </div>
                    </div>

                    {/* Troubleshooting */}
                    <div>
                      <h4 className="font-bold text-white mb-2 text-base">Common Questions</h4>

                      <div className="space-y-2 ml-3">
                        <div>
                          <p className="font-semibold text-gray-800 text-xs mb-1">&quot;My credentials aren&apos;t working&quot;</p>
                          <ul className="text-xs text-gray-300 ml-4 list-disc">
                            <li>Make sure you&apos;re using the <strong>API password</strong>, not your account login password</li>
                            <li>Go to <a href="https://app.dataforseo.com/api-access" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">API Access</a> and click &quot;Send by e-mail&quot; to receive your API password</li>
                            <li>Check for extra spaces before or after your credentials</li>
                          </ul>
                        </div>

                        <div>
                          <p className="font-semibold text-gray-800 text-xs mb-1">&quot;I can&apos;t see my API password&quot;</p>
                          <ul className="text-xs text-gray-300 ml-4 list-disc">
                            <li>The API password is only visible for 24 hours after registration</li>
                            <li>After that, click &quot;Send by e-mail&quot; on the API Access page</li>
                            <li>The password will be sent to your registration email</li>
                          </ul>
                        </div>

                        <div>
                          <p className="font-semibold text-gray-800 text-xs mb-1">&quot;Research paused — insufficient balance&quot;</p>
                          <ul className="text-xs text-gray-300 ml-4 list-disc">
                            <li>Your DataForSEO balance ran out mid-research</li>
                            <li>Add more funds at <a href="https://app.dataforseo.com/api-dashboard" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">app.dataforseo.com</a></li>
                            <li>Then click &quot;Resume&quot; on your research session — it will pick up where it left off</li>
                          </ul>
                        </div>

                        <div>
                          <p className="font-semibold text-gray-800 text-xs mb-1">&quot;Can I use the $1 free credit to test?&quot;</p>
                          <ul className="text-xs text-gray-300 ml-4 list-disc">
                            <li>Yes! The $1 free credit is enough to validate your credentials in the Research Automation Engine</li>
                            <li>To run a full enhanced research session, you&apos;ll need to add at least $50</li>
                          </ul>
                        </div>
                      </div>
                    </div>

                    {/* Quick Reference */}
                    <div className="pt-3 border-t border-white/10">
                      <p className="text-xs font-semibold text-gray-300 mb-2">🔗 Quick Reference Links:</p>
                      <ul className="text-xs text-gray-400 space-y-1">
                        <li>• <a href="https://app.dataforseo.com/register" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">Register</a></li>
                        <li>• <a href="https://app.dataforseo.com/api-dashboard" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">Dashboard</a></li>
                        <li>• <a href="https://app.dataforseo.com/api-access" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">API Access (credentials)</a></li>
                        <li>• <a href="https://app.dataforseo.com/api-settings" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">API Settings (spending limits)</a></li>
                        <li>• <a href="https://app.dataforseo.com/api-detail/serp" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">Usage & Spending</a></li>
                        <li>• <a href="https://dataforseo.com/pricing" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">Pricing</a></li>
                        <li>• <a href="https://docs.dataforseo.com/" target="_blank" rel="noopener noreferrer" className="text-cyan-electric hover:text-cyan-electric/80 transition">API Documentation</a></li>
                      </ul>
                    </div>
                  </div>
                </ExpandableGuide>
              </div>

              {/* Total Cost Estimate */}
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800">
                  <strong>💡 Total Estimated Cost per Research:</strong> Each complete 4-phase research costs approximately <strong>$2.50 – $3.00</strong> in combined API usage.
                </p>
                <p className="text-xs text-green-700 mt-2">
                  • Claude (AI synthesis): ~$2.50 per report<br/>
                  • Tavily (web search): Free tier covers most usage (1,000 searches/month)<br/>
                  • DataForSEO (optional): ~$0.30 – $0.45 per research session
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

