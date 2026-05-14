import { config as loadEnv } from 'dotenv';
import path from 'path';
import type { NextConfig } from 'next';

// Preload root `.env` at config evaluation time (optional; Next also loads it for the app).
loadEnv({ path: path.join(process.cwd(), '.env') });

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
