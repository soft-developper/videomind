// vm_admin: the VideoMind admin dashboard (dashboard.vidzmind.xyz).
// Its own Vercel project, root directory "dashboard". It talks only to the
// API's /api/admin routes, with an httpOnly cookie the API sets.
/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000",
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        // Links with tokens (setup, reset) must never leak in a Referer header.
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default nextConfig;
