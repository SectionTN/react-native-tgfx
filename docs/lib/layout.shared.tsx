import type { HomeLayoutProps } from 'fumadocs-ui/layouts/home'
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import { siteConfig } from '@/lib/site-config'

export const docsShellClassName = 'vc-docs-shell flex flex-col'
export const docsShellHeaderClassName = 'max-md:hidden'
export const docsLayoutContainerClassName = 'vc-docs-layout'
export const apiReferenceSidebarWidthClassName =
  'md:[--fd-sidebar-width:19rem] lg:[--fd-sidebar-width:20rem]'

function MargeloBrandIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 30 30"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0V30H30L0 0Z" />
      <path d="M30 0V30L19.007 10.9941L30 0Z" />
    </svg>
  )
}

function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={`ml-2 text-[17px] font-semibold tracking-tight ${className ?? ''}`}
    >
      react-native-<span className="text-fd-primary">tgfx</span>
    </span>
  )
}

export function sideBarOptions(): BaseLayoutProps {
  return {
    themeSwitch: {
      enabled: false,
    },
    nav: {
      title: <Wordmark className="vc-mobile-sidebar-logo md:hidden" />,
    },
  }
}

export function homeOptions(): HomeLayoutProps {
  return {
    links: [
      {
        text: 'Docs',
        url: '/docs',
        active: 'nested-url',
      },
      {
        text: 'API Reference',
        url: '/api',
        active: 'nested-url',
      },
      {
        type: 'icon',
        text: 'Margelo',
        label: 'Margelo',
        url: 'https://margelo.com',
        icon: <MargeloBrandIcon />,
        external: true,
      },
    ],
    githubUrl: siteConfig.repositoryUrl,
    nav: {
      title: <Wordmark />,
    },
  }
}
