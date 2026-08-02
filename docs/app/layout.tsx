import './global.css'
import { Archivo, IBM_Plex_Mono, Newsreader } from 'next/font/google'
import { RootProvider } from 'fumadocs-ui/provider/next'
import type { ReactNode } from 'react'

const display = Archivo({ subsets: ['latin'], variable: '--font-archivo', weight: ['400', '500', '600', '700'] })
const body = Newsreader({ subsets: ['latin'], variable: '--font-newsreader', weight: ['400', '500', '600'] })
const mono = IBM_Plex_Mono({ subsets: ['latin'], variable: '--font-plex', weight: ['400', '500', '600'] })

export const metadata = {
  title: { default: 'react-native-tgfx', template: '%s · react-native-tgfx' },
  description:
    'A declarative GPU 2D canvas for React Native, backed by Tencent tgfx. Animate on the thread that paints.',
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
