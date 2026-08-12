import { notFound } from 'next/navigation'
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page'
import { getMDXComponents } from '@/components/mdx'
import type { apiSource } from '@/lib/source'

type Source = typeof apiSource
type Params = Promise<{ slug?: string[] }>

export function createDocsRoute(source: Source) {
  async function Page({ params }: { params: Params }) {
    const page = source.getPage((await params).slug)
    if (!page) notFound()

    const MDX = page.data.body

    return (
      <DocsPage toc={page.data.toc} full={page.data.full}>
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
