import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  distDir: process.env.BREAD_DIST_DIR || '.next',
  turbopack: { root: process.cwd() },
  agentRules: false,
  poweredByHeader: false,
  async headers() { return [{ source: '/:path*', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=()' },
    { key: 'X-Frame-Options', value: 'DENY' }
  ] }, { source: '/design/fonts/:file.woff2', headers: [
    { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }
  ] }]; }
};
export default nextConfig;
