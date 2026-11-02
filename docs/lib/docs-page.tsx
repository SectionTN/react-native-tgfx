import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/layouts/docs/page'
import { createRelativeLink } from 'fumadocs-ui/mdx'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getMDXComponents } from '@/components/mdx'
import { LetsTalkWidget } from '@/components/lets-talk-widget'
import { LLMCopyButton, ViewOptions } from '@/components/page-actions'
import {
  type DocsScope,
  getGithubContentUrl,
  getMarkdownPath,
  getOgImagePath,
  siteConfig,
} from '@/lib/site-config'
import { apiSource, docsSource } from '@/lib/source'

type Params = Promise<{ slug?: string[] }>

const sources = { docs: docsSource, api: apiSource } as const

export function createDocsRoute(scope: DocsScope) {
  const source = sources[scope]

  async function Page({ params }: { params: Params }) {
    const page = source.getPage((await params).slug)
    if (!page) notFound()

    const MDX = page.data.body
    const markdownUrl = getMarkdownPath(page.url)
    const githubUrl = getGithubContentUrl(scope, page.path)

    return (
      <DocsPage
        toc={page.data.toc}
        full={page.data.full}
        tableOfContent={{ footer: <LetsTalkWidget /> }}
      >
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription className="mb-2">
          {page.data.description}
        </DocsDescription>
        <div className="flex flex-row gap-2 items-center border-b pb-6">
          <LLMCopyButton markdownUrl={markdownUrl} />
          <ViewOptions markdownUrl={markdownUrl} githubUrl={githubUrl} />
        </div>
        <DocsBody className="[&>*:first-child]:mt-0.5 prose-lg prose-h3:text-2xl prose-h3:leading-tight">
          <MDX
            components={getMDXComponents(
              {
                // this allows you to link to other pages with relative file paths
                a: createRelativeLink(source, page),
              },
              {
                codeBlock: {
                  viewportClassName: 'text-sm',
                },
              },
            )}
          />
        </DocsBody>
      </DocsPage>
    )
  }

  async function generateMetadata({
    params,
  }: {
    params: Params
  }): Promise<Metadata> {
    const page = source.getPage((await params).slug)
    if (!page) notFound()

    const image = getOgImagePath(page.url)

    return {
      title: page.data.title,
      description: page.data.description,
      alternates: {
        canonical: page.url,
      },
      openGraph: {
        siteName: siteConfig.name,
        url: page.url,
        images: image,
      },
      twitter: {
        card: 'summary_large_image',
        images: image,
      },
    }
  }

  return {
    Page,
    generateStaticParams: () => source.generateParams(),
    generateMetadata,
  }
}
