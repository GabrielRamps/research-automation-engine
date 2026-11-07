/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  
  // Security: Hide server information to prevent information disclosure
  poweredByHeader: false,
  
  // Additional security headers
  async headers() {
    return [
      {
        // Apply to all routes
        source: '/:path*',
        headers: [
          {
            key: 'X-Powered-By',
            value: '', // Remove X-Powered-By header
          },
        ],
      },
    ];
  },
}

module.exports = nextConfig

