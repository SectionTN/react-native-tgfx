import { createDocsRoute } from '@/lib/docs-route'
import { docsSource } from '@/lib/source'

const route = createDocsRoute(docsSource)

export default route.Page
export const generateStaticParams = route.generateStaticParams
export const generateMetadata = route.generateMetadata
