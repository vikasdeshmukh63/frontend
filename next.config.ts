import { config as loadEnv } from 'dotenv';
import path from 'path';
import type { NextConfig } from 'next';

// Next.js only auto-loads `.env*` from the project root; many setups keep secrets under `src/`.
for (const file of ['src/.env.local', 'src/.env']) {
  loadEnv({ path: path.join(process.cwd(), file) });
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
