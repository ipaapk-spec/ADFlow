import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp"],
  outputFileTracingRoot: process.cwd(),
  devIndicators: false,
};

export default nextConfig;
