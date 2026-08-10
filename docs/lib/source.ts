import { apiReference, docs } from '@/.source/server'
import { loader } from 'fumadocs-core/source'
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons'

export const docsSource = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
})

export const apiSource = loader({
  baseUrl: '/api',
  source: apiReference.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
})
