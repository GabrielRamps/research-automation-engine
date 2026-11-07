export default function SetupGuide() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Claude API Setup Guide</h1>
          <p className="text-gray-600 mb-8">
            Follow these steps to get your Claude API key and start using the Research Automation Engine.
          </p>
          
          {/* Step by Step Guide */}
          <div className="space-y-8">
            {/* Step 1 */}
            <div className="border-l-4 border-blue-600 pl-6">
              <div className="flex items-center space-x-3 mb-3">
                <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                  1
                </div>
                <h2 className="text-2xl font-semibold text-gray-900">Create Anthropic Account</h2>
              </div>
              <p className="text-gray-700 mb-3">
                Go to <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">console.anthropic.com</a> and sign up for a new account or log in if you already have one.
              </p>
            </div>
            
            {/* Step 2 */}
            <div className="border-l-4 border-blue-600 pl-6">
              <div className="flex items-center space-x-3 mb-3">
                <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                  2
                </div>
                <h2 className="text-2xl font-semibold text-gray-900">Add Billing Information</h2>
              </div>
              <p className="text-gray-700 mb-3">
                Navigate to &quot;Settings&quot; → &quot;Billing&quot; and add your payment method. You&apos;ll need to add credits to use the API.
              </p>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-3">
                <p className="text-sm text-yellow-800">
                  <strong>💰 Cost Estimate:</strong> Each research generation typically costs $0.50-$2.00 depending on complexity. 
                  We recommend starting with $20-$50 in credits.
                </p>
              </div>
            </div>
            
            {/* Step 3 */}
            <div className="border-l-4 border-blue-600 pl-6">
              <div className="flex items-center space-x-3 mb-3">
                <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                  3
                </div>
                <h2 className="text-2xl font-semibold text-gray-900">Generate API Key</h2>
              </div>
              <p className="text-gray-700 mb-3">
                Click on &quot;API Keys&quot; in the left sidebar, then click the &quot;Create Key&quot; button.
              </p>
              <p className="text-gray-700 mb-3">
                Give your key a name (e.g., &quot;Research Automation&quot;) and click &quot;Create&quot;.
              </p>
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mt-3">
                <p className="text-sm text-red-800">
                  <strong>⚠️ Important:</strong> Copy your API key immediately! You won&apos;t be able to see it again. 
                  It will start with <code className="bg-red-100 px-2 py-1 rounded">sk-ant-</code>
                </p>
              </div>
            </div>
            
            {/* Step 4 */}
            <div className="border-l-4 border-blue-600 pl-6">
              <div className="flex items-center space-x-3 mb-3">
                <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                  4
                </div>
                <h2 className="text-2xl font-semibold text-gray-900">Add Key to Dashboard</h2>
              </div>
              <p className="text-gray-700 mb-3">
                Return to your Research Automation Engine dashboard and paste your API key when prompted.
              </p>
              <p className="text-gray-700">
                Your key is stored securely in your browser and never sent to our servers. You can change it anytime from the dashboard.
              </p>
            </div>
          </div>
          
          {/* FAQ Section */}
          <div className="mt-12 pt-8 border-t border-gray-200">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Frequently Asked Questions</h2>
            
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  How much does it cost to use Claude API?
                </h3>
                <p className="text-gray-700">
                  Claude API uses pay-as-you-go pricing. Each research generation typically costs between $0.50-$2.00 
                  depending on the complexity and length. You only pay for what you use.
                </p>
              </div>
              
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Is my API key secure?
                </h3>
                <p className="text-gray-700">
                  Yes! Your API key is stored only in your browser&apos;s local storage and is never sent to our servers. 
                  It&apos;s used directly from your browser to call the Claude API.
                </p>
              </div>
              
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Can I use the same API key on multiple devices?
                </h3>
                <p className="text-gray-700">
                  Yes, you can use the same API key on multiple devices. Just enter it in the dashboard on each device you want to use.
                </p>
              </div>
              
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  What if I run out of credits?
                </h3>
                <p className="text-gray-700">
                  You&apos;ll need to add more credits to your Anthropic account. The generation will fail with an error message 
                  if you don&apos;t have sufficient credits.
                </p>
              </div>
              
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Which Claude model is used?
                </h3>
                <p className="text-gray-700">
                  We use Claude Sonnet 4 (released May 2025), which provides the best balance of quality, speed, and cost 
                  for research generation tasks.
                </p>
              </div>
            </div>
          </div>
          
          {/* CTA */}
          <div className="mt-12 pt-8 border-t border-gray-200 text-center">
            <h3 className="text-xl font-semibold text-gray-900 mb-4">Ready to get started?</h3>
            <a
              href="/dashboard"
              className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 font-semibold transition shadow-md hover:shadow-lg"
            >
              Go to Dashboard
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

