import type { NextConfig } from "next";

const basePath = process.env.GITHUB_ACTIONS === "true" ? "/weibo-hot-hub" : "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath,
  assetPrefix: basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  turbopack: { root: process.cwd() },
};

export default nextConfig;
