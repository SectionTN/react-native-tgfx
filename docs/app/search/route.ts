import { createSearchAPI } from 'fumadocs-core/search/server'
import { apiSource, docsSource } from '@/lib/source'

export const { GET } = createSearchAPI('advanced', {
  indexes: [...docsSource.getPages(), ...apiSource.getPages()].map((page) => ({
    id: page.url,
    url: page.url,
    title: page.data.title,
    description: page.data.description,
    structuredData: page.data.structuredData,
  })),
})
