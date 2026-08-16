import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "pbs.twimg.com", pathname: "/**" },
      { protocol: "https", hostname: "video.twimg.com", pathname: "/**" },
    ],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
