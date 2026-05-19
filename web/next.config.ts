import path from "node:path";
import type { NextConfig } from "next";

// CAPACITOR_BUILD=1 builds a static export (web/out/) for bundling inside the
// Android APK. The Vercel deploy uses the default (server) build so the API
// routes stay live.
const isCapacitorBuild = process.env.CAPACITOR_BUILD === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin Turbopack's workspace root to web/. Without this, Next 16 walks up to
  // the repo root, sees the Capacitor wrapper package.json, and treats the
  // entire monorepo (android/, web/node_modules, build artifacts) as the
  // workspace — which exploded dev-server memory to >100GB on 2026-05-18.
  turbopack: { root: path.resolve(__dirname) },
  ...(isCapacitorBuild
    ? { output: "export", images: { unoptimized: true } }
    : { experimental: { serverActions: { bodySizeLimit: "2mb" } } }),
};

export default nextConfig;
