import './global.css'
import { Geist, Geist_Mono } from 'next/font/google'
import { RootProvider } from 'fumadocs-ui/provider/next'
import type { ReactNode } from 'react'

const sans = Geist({ subsets: ['latin'], variable: '--font-geist' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

export const metadata = {
  metadataBase: new URL('https://tgfx.margelo.com'),
  twitter: { card: 'summary_large_image' },
  title: { default: 'react-native-tgfx', template: '%s · react-native-tgfx' },
  description:
    'A declarative GPU 2D canvas for React Native, backed by Tencent tgfx. Animate on the thread that paints.',
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider search={{ options: { api: '/search' } }}>{children}</RootProvider>
      </body>
    </html>
  )
}
