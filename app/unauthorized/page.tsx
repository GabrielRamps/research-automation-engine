'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function UnauthorizedPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const route = searchParams.get('route') || 'admin area';
  const attempts = parseInt(searchParams.get('attempts') || '1', 10);
  
  const [countdown, setCountdown] = useState(25);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          router.push('/dashboard');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [router]);

  const getSeverityLevel = () => {
    if (attempts >= 5) return 'critical';
    if (attempts >= 3) return 'high';
    return 'medium';
  };

  const severity = getSeverityLevel();

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-orange-50 to-yellow-50 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        {/* Warning Card */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border-4 border-red-500">
          {/* Header */}
          <div className="bg-gradient-to-r from-red-600 to-red-700 px-8 py-6">
            <div className="flex items-center gap-4">
              <div className="bg-white rounded-full p-3">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white">Access Denied</h1>
                <p className="text-red-100 mt-1">Unauthorized Access Attempt Detected</p>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="px-8 py-8">
            {/* Main Message */}
            <div className="mb-6">
              <p className="text-lg text-gray-800 mb-4">
                You attempted to access: <span className="font-mono font-semibold text-red-600">{route}</span>
              </p>
              <p className="text-gray-700">
                This area is restricted to administrators only. Your access attempt has been logged and security has been notified.
              </p>
            </div>

            {/* Attempt Counter */}
            <div className={`rounded-lg p-4 mb-6 ${
              severity === 'critical' ? 'bg-red-100 border-2 border-red-500' :
              severity === 'high' ? 'bg-orange-100 border-2 border-orange-500' :
              'bg-yellow-100 border-2 border-yellow-500'
            }`}>
              <div className="flex items-start gap-3">
                <svg className={`w-6 h-6 flex-shrink-0 ${
                  severity === 'critical' ? 'text-red-600' :
                  severity === 'high' ? 'text-orange-600' :
                  'text-yellow-600'
                }`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div className="flex-1">
                  <p className={`font-semibold mb-2 ${
                    severity === 'critical' ? 'text-red-800' :
                    severity === 'high' ? 'text-orange-800' :
                    'text-yellow-800'
                  }`}>
                    {attempts === 1 && 'First Warning'}
                    {attempts === 2 && 'Second Warning'}
                    {attempts >= 3 && attempts < 5 && 'Multiple Violations Detected'}
                    {attempts >= 5 && '⚠️ FINAL WARNING ⚠️'}
                  </p>
                  <p className={`text-sm ${
                    severity === 'critical' ? 'text-red-700' :
                    severity === 'high' ? 'text-orange-700' :
                    'text-yellow-700'
                  }`}>
                    {attempts < 3 && `Unauthorized access attempts: ${attempts}`}
                    {attempts >= 3 && attempts < 5 && `You have made ${attempts} unauthorized access attempts.`}
                    {attempts >= 5 && `You have made ${attempts} unauthorized access attempts. Your account is at risk of suspension.`}
                  </p>
                </div>
              </div>
            </div>

            {/* Consequences */}
            <div className="bg-gray-50 rounded-lg p-6 mb-6">
              <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Security Policy
              </h2>
              <ul className="space-y-2 text-sm text-gray-700">
                <li className="flex items-start gap-2">
                  <span className="text-red-500 font-bold">•</span>
                  <span><strong>3+ attempts:</strong> Your account will be flagged for review</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-500 font-bold">•</span>
                  <span><strong>5+ attempts:</strong> Your account will be temporarily suspended</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-500 font-bold">•</span>
                  <span><strong>10+ attempts:</strong> Your account will be permanently deactivated</span>
                </li>
                <li className="flex items-start gap-2 mt-3 pt-3 border-t border-gray-300">
                  <span className="text-blue-500 font-bold">ℹ</span>
                  <span>To regain access after suspension, you must contact support and request manual reactivation.</span>
                </li>
              </ul>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => router.push('/dashboard')}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                Return to Dashboard
              </button>
              <button
                onClick={() => router.push('/')}
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                Log Out
              </button>
            </div>

            {/* Auto-redirect notice */}
            <p className="text-center text-sm text-gray-500 mt-4">
              Auto-redirecting to dashboard in {countdown} seconds...
            </p>
          </div>

          {/* Footer */}
          <div className="bg-gray-50 px-8 py-4 border-t border-gray-200">
            <p className="text-xs text-gray-600 text-center">
              This security incident has been recorded. Your IP address, user ID, and access attempt details have been logged.
            </p>
          </div>
        </div>

        {/* Help Text */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            If you believe you should have access to admin areas, please contact your administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
