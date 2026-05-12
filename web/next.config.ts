import type { NextConfig } from "next";

// CAPACITOR_BUILD=1 builds a static export (web/out/) for bundling inside the
// Android APK. The Vercel deploy uses the default (server) build so the API
// routes stay live.
const isCapacitorBuild = process.env.CAPACITOR_BUILD === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(isCapacitorBuild
    ? { output: "export", images: { unoptimized: true } }
    : { experimental: { serverActions: { bodySizeLimit: "2mb" } } }),
};

export default nextConfig;
