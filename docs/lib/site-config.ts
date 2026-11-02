const DEFAULT_SITE_URL = 'https://tgfx.margelo.com'
const DEFAULT_BRANCH = 'main'

export const siteConfig = {
  name: 'react-native-tgfx',
  description:
    'A declarative GPU 2D canvas for React Native, backed by Tencent tgfx. Animate on the thread that paints.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL),
  repositoryUrl: 'https://github.com/margelo/react-native-tgfx',
  repositoryBranch: DEFAULT_BRANCH,
  contentRoots: {
    docs: 'docs/content/docs',
    api: 'docs/content/api',
  },
} as const

export type DocsScope = keyof typeof siteConfig.contentRoots

export function absoluteUrl(pathname: string): string {
  return new URL(pathname, siteConfig.metadataBase).toString()
}

export function getMarkdownPath(pageUrl: string): string {
  return `${pageUrl}.md`
}

export function getOgImagePath(pageUrl: string): string {
  return `/og${pageUrl}/image.png`
}

export function getGithubContentUrl(
  scope: DocsScope,
  pagePath: string,
): string {
  const root = siteConfig.contentRoots[scope]
  return `${siteConfig.repositoryUrl}/blob/${siteConfig.repositoryBranch}/${root}/${pagePath}`
}
