import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
export default withMDX({
  reactStrictMode: true,
  // Next stamps prerendered pages with a one-year s-maxage. On Workers that is
  // Cloudflare's edge cache, so a redeploy keeps serving the old HTML until it
  // expires. Hashed assets under /_next/static keep their long life; the pages
  // themselves revalidate.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, s-maxage=60, stale-while-revalidate=86400',
          },
        ],
      },
    ]
  },
})
