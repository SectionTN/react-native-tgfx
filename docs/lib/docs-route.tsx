import { notFound } from 'next/navigation'
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page'
import { getMDXComponents } from '@/components/mdx'
import type { apiSource } from '@/lib/source'

type Source = typeof apiSource
type Params = Promise<{ slug?: string[] }>

function MargeloCard() {
  return (
    <aside className="tg-margelo">
      <p className="tg-margelo-title">Building something ambitious?</p>
      <p className="tg-margelo-sub">
        We help teams ship world-class React Native apps.
      </p>
      <a className="tg-cta tg-margelo-cta" href="https://margelo.com" rel="noopener">
        <span className="tg-cta-bg" />
        <span className="tg-cta-text">Let&rsquo;s talk</span>
        <span className="tg-cta-circle" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
            <path
              d="M3 9H15M15 9L10 4M15 9L10 14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </a>
    </aside>
  )
}

export function createDocsRoute(source: Source) {
  async function Page({ params }: { params: Params }) {
    const page = source.getPage((await params).slug)
    if (!page) notFound()

    const MDX = page.data.body

    return (
      <DocsPage
        toc={page.data.toc}
        full={page.data.full}
        tableOfContent={{ footer: <MargeloCard /> }}
      >
        {/* Keyed so the enter animation replays when the route changes under the same segment. */}
        <div key={page.url} className="tg-enter flex flex-col gap-4">
          <DocsTitle>{page.data.title}</DocsTitle>
          <DocsDescription>{page.data.description}</DocsDescription>
          <DocsBody>
            <MDX components={getMDXComponents()} />
          </DocsBody>
        </div>
      </DocsPage>
    )
  }

  return {
    Page,
    generateStaticParams: () => source.generateParams(),
    generateMetadata: async ({ params }: { params: Params }) => {
      const page = source.getPage((await params).slug)
      if (!page) notFound()
      return { title: page.data.title, description: page.data.description }
    },
  }
}
