import { createDocsRoute } from '@/lib/docs-route'
import { apiSource } from '@/lib/source'

const route = createDocsRoute(apiSource)

export default route.Page
export const generateStaticParams = route.generateStaticParams
export const generateMetadata = route.generateMetadata
