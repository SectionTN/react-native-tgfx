import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
export default withMDX({
  reactStrictMode: true,
  rewrites: async () => [
    { source: '/docs.md', destination: '/llms.mdx/docs' },
    { source: '/docs/:path*.md', destination: '/llms.mdx/docs/:path*' },
    { source: '/docs.mdx', destination: '/llms.mdx/docs' },
    { source: '/docs/:path*.mdx', destination: '/llms.mdx/docs/:path*' },
    { source: '/api.md', destination: '/llms.mdx/api' },
    { source: '/api/:path*.md', destination: '/llms.mdx/api/:path*' },
    { source: '/api.mdx', destination: '/llms.mdx/api' },
    { source: '/api/:path*.mdx', destination: '/llms.mdx/api/:path*' },
  ],
})
