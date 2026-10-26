import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@kimo/client', '@kimo/compositor'],
  experimental: { cpus: 1 },
  poweredByHeader: false,
};
export default config;
