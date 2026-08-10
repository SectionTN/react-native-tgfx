import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import { BookOpen, Braces } from 'lucide-react'

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <span className="font-display text-[15px] font-semibold tracking-tight">
        react-native-tgfx
      </span>
    ),
  },
  links: [
    { text: 'Docs', url: '/docs', icon: <BookOpen /> },
    { text: 'API Reference', url: '/api', icon: <Braces /> },
  ],
  githubUrl: 'https://github.com/riteshshukla04/react-native-tgfx',
}
