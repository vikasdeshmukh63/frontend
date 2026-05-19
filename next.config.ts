import { config as loadEnv } from 'dotenv';
import path from 'path';
import type { NextConfig } from 'next';

// Preload root `.env` at config evaluation time (optional; Next also loads it for the app).
loadEnv({ path: path.join(process.cwd(), '.env') });

const excloudHosts = [
  process.env.EXCLOUD_S3_ENDPOINT?.replace(/^https?:\/\//, ''),
  '1015.objects.excloud.dev',
  'buckets.excloud.dev',
].filter((h): h is string => Boolean(h));

const nextConfig: NextConfig = {
  images: {
    remotePatterns: excloudHosts.map((hostname) => ({
      protocol: 'https' as const,
      hostname,
      pathname: '/**',
    })),
  },
};

export default nextConfig;
