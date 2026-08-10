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
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
        <DocsBody>
          <MDX components={getMDXComponents()} />
        </DocsBody>
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
