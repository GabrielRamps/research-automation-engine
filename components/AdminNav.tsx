'use client';

import { useRouter, usePathname } from 'next/navigation';

export default function AdminNav() {
  const router = useRouter();
  const pathname = usePathname();

  const navItems = [
    { path: '/admin', label: '⚙️ Admin Panel', color: 'gray' },
    { path: '/admin/dashboard', label: '📊 Security & Analytics', color: 'green' },
    { path: '/admin/session-health', label: '🩺 Session Health', color: 'red' },
    { path: '/admin/user-management', label: '👤 User Management', color: 'red' },
    { path: '/admin/manage-admins', label: '👥 Manage Admins', color: 'blue' },
    { path: '/admin/research-prompts', label: '🔬 Research Prompts', color: 'purple' },
    { path: '/admin/tavily-config', label: '🔧 Tavily Config', color: 'indigo' },
    { path: '/admin/dataforseo-config', label: '📊 DataForSEO Config', color: 'orange' },
    { path: '/admin/test-dataforseo', label: '🧪 Test DataForSEO', color: 'orange' },
    { path: '/admin/announcement', label: '📢 Announcement Banner', color: 'red' },
    { path: '/admin/email-blast', label: '✉️ Email Blast', color: 'blue' },
  ];

  const getButtonClasses = (path: string, color: string) => {
    const isActive = pathname === path;
    
    if (isActive) {
      // Active state - solid background
      const activeColors: Record<string, string> = {
        gray: 'bg-gray-700 text-white border-gray-700',
        green: 'bg-green-700 text-white border-green-700',
        blue: 'bg-blue-700 text-white border-blue-700',
        purple: 'bg-purple-700 text-white border-purple-700',
        indigo: 'bg-indigo-700 text-white border-indigo-700',
        orange: 'bg-orange-700 text-white border-orange-700',
        red: 'bg-red-700 text-white border-red-700',
      };
      return `${activeColors[color] || activeColors.orange} font-semibold`;
    }
    
    // Inactive state - outlined
    const inactiveColors: Record<string, string> = {
      gray: 'text-gray-600 hover:text-gray-700 border-gray-300 hover:border-gray-400 hover:bg-gray-50',
      green: 'text-green-600 hover:text-green-700 border-green-600 hover:bg-green-50',
      blue: 'text-blue-600 hover:text-blue-700 border-blue-600 hover:bg-blue-50',
      purple: 'text-purple-600 hover:text-purple-700 border-purple-600 hover:bg-purple-50',
      indigo: 'text-indigo-600 hover:text-indigo-700 border-indigo-600 hover:bg-indigo-50',
      orange: 'text-orange-600 hover:text-orange-700 border-orange-600 hover:bg-orange-50',
      red: 'text-red-600 hover:text-red-700 border-red-600 hover:bg-red-50',
    };
    return inactiveColors[color];
  };

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {navItems.map((item) => (
        <button
          key={item.path}
          onClick={() => router.push(item.path)}
          className={`text-sm font-medium px-4 py-2 rounded-lg border transition-colors ${getButtonClasses(item.path, item.color)}`}
        >
          {item.label}
        </button>
      ))}
      <div className="border-l border-gray-300 h-8 mx-2"></div>
      <button
        onClick={() => router.push('/dashboard')}
        className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2 rounded-lg border border-gray-300 hover:border-gray-400 hover:bg-gray-50"
      >
        ← Back to Dashboard
      </button>
    </div>
  );
}
