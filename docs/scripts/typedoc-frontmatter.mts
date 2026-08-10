import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { MarkdownPageEvent, MarkdownRendererEvent } from 'typedoc-plugin-markdown'
import type { MarkdownApplication } from 'typedoc-plugin-markdown'

const ICONS: Record<string, string> = {
  interfaces: 'Braces',
  'type-aliases': 'Type',
  functions: 'Parentheses',
  variables: 'Box',
}

const GROUPS: Array<[dir: string, title: string]> = [
  ['functions', 'Functions & Hooks'],
  ['variables', 'Components'],
  ['interfaces', 'Interfaces'],
  ['type-aliases', 'Type Aliases'],
]

export function load(app: MarkdownApplication) {
  app.renderer.on(MarkdownPageEvent.BEGIN, (page) => {
    page.frontmatter = {
      title: page.model?.name ?? 'API Reference',
      ...page.frontmatter,
    }
  })

  // Typedoc emits directory-relative links (e.g. `interfaces/Foo` from the
  // `/api` index page, with no `../`). Next serves `/api` without a trailing
  // slash, so the browser resolves that against `/` instead of `/api/` and
  // 404s. Rewrite every local link to an absolute `/api/...` path instead.
  app.renderer.on(MarkdownPageEvent.END, (page) => {
    page.contents = page.contents?.replace(/\]\(([^)\s]+)\)/g, (match, href: string) => {
      if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(href) || href.startsWith('mailto:') || href.startsWith('/') || href.startsWith('#')) {
        return match
      }
      const [target, hash] = href.split('#')
      if (!target) return match
      const resolved = path
        .posix.normalize(path.posix.join(path.posix.dirname(page.url), target))
        .replace(/\.mdx$/, '')
      return `](/api/${resolved}${hash ? `#${hash}` : ''})`
    })
  })

  // Typedoc emits no meta.json, so fumadocs would title the groups by folder name.
  app.renderer.on(MarkdownRendererEvent.END, (event) => {
    const write = (dir: string, meta: object) => {
      mkdirSync(path.join(event.outputDirectory, dir), { recursive: true })
      writeFileSync(
        path.join(event.outputDirectory, dir, 'meta.json'),
        `${JSON.stringify(meta, null, 2)}\n`
      )
    }

    write('.', {
      title: 'API Reference',
      root: true,
      pages: ['index', ...GROUPS.map(([dir]) => dir)],
    })
    for (const [dir, title] of GROUPS) {
      write(dir, { title, icon: ICONS[dir] })
    }
  })
}
