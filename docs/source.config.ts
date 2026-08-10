import { defineConfig, defineDocs } from 'fumadocs-mdx/config'

export const docs = defineDocs({ dir: 'content/docs' })

export const apiReference = defineDocs({ dir: 'content/api' })

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: { light: 'github-light', dark: 'github-dark-default' },
    },
  },
})
