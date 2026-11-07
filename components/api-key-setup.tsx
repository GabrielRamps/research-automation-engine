'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface ApiKeySetupProps {
  onComplete: () => void;
}

export default function ApiKeySetup({ onComplete }: ApiKeySetupProps) {
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');

  async function validateApiKey() {
    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }

    if (!apiKey.startsWith('sk-ant-')) {
      setError('Invalid API key format. Claude API keys start with "sk-ant-"');
      return;
    }

    setTesting(true);
    setError('');

    try {
      // Validate the API key through our server endpoint
      const response = await fetch('/api/validate-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          apiKey
        })
      });

      const data = (await response.json()) as { valid?: boolean; error?: string };

      if (response.ok && data.valid) {
        // API key is valid, save it
        localStorage.setItem('claude_api_key', apiKey);
        onComplete();
      } else {
        setError(data.error || 'Invalid API key');
      }
    } catch (err: any) {
      setError('Failed to validate API key. Please try again.');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="max-w-2xl w-full">
        <Card>
          <CardHeader>
            <CardTitle>Set Up Your Claude API Key</CardTitle>
            <CardDescription>
              To use the Research Automation Engine, you need to provide your own Claude API key.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* API Key Input */}
            <div className="space-y-2">
              <label htmlFor="api-key" className="block text-sm font-medium text-gray-700">
                Claude API Key
              </label>
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-..."
                className="font-mono text-sm"
              />
              <p className="text-xs text-gray-500">
                Your API key is stored locally in your browser and never sent to our servers.
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <Button
              onClick={validateApiKey}
              disabled={testing}
              className="w-full"
              size="lg"
            >
              {testing ? 'Validating...' : 'Validate & Continue'}
            </Button>

            {/* Setup Instructions */}
            <div className="border-t pt-6">
              <h3 className="font-semibold mb-3">How to get your Claude API key:</h3>
              <ol className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start">
                  <span className="font-semibold mr-2 text-blue-600">1.</span>
                  <span>Go to <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">console.anthropic.com</a></span>
                </li>
                <li className="flex items-start">
                  <span className="font-semibold mr-2 text-blue-600">2.</span>
                  <span>Sign up or log in to your account</span>
                </li>
                <li className="flex items-start">
                  <span className="font-semibold mr-2 text-blue-600">3.</span>
                  <span>Click on &quot;API Keys&quot; in the left sidebar</span>
                </li>
                <li className="flex items-start">
                  <span className="font-semibold mr-2 text-blue-600">4.</span>
                  <span>Click &quot;Create Key&quot; and copy your new API key</span>
                </li>
                <li className="flex items-start">
                  <span className="font-semibold mr-2 text-blue-600">5.</span>
                  <span>Paste it above and click &quot;Validate & Continue&quot;</span>
                </li>
              </ol>

              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>💡 Tip:</strong> You&apos;ll need to add credits to your Anthropic account. 
                  Most research generations cost $0.50-$2.00 depending on complexity.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

