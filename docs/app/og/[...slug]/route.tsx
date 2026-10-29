import { notFound } from 'next/navigation'
import { renderOg } from '@/lib/og'
import { apiSource, docsSource } from '@/lib/source'

const sources = { docs: docsSource, api: apiSource }
type Section = keyof typeof sources

// /og/<section>/<page slug...>/image.png
export async function GET(_: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const [section, ...rest] = (await params).slug
  const page = sources[section as Section]?.getPage(rest.slice(0, -1))
  if (!page) notFound()
  const crumbs = page.url.split('/').filter(Boolean).slice(0, -1)
  return renderOg({
    crumbs: crumbs.length ? crumbs : [section],
    title: page.data.title,
    description: page.data.description,
  })
}

export const dynamicParams = false

export function generateStaticParams() {
  return (Object.keys(sources) as Section[]).flatMap((section) =>
    sources[section].getPages().map((p) => ({ slug: [section, ...p.slugs, 'image.png'] }))
  )
}
