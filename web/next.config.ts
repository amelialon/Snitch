import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Opening the dev app by LAN IP instead of localhost is blocked by default, which stops the page
  // from hydrating (checkboxes and buttons appear dead).
  allowedDevOrigins: ["10.37.105.100"],
};

export default nextConfig;
