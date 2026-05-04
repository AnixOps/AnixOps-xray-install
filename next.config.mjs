/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["node-ssh", "ssh2"],
  // For Cloudflare Pages deployment:
  // npx @cloudflare/next-on-pages generates .vercel/output/static
  // wrangler pages deploy handles the routing
};

export default nextConfig;
