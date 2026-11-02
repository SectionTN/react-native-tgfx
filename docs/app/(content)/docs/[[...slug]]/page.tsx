import { createDocsRoute } from '@/lib/docs-page'

const route = createDocsRoute('docs')

export default route.Page
export const generateStaticParams = route.generateStaticParams
export const generateMetadata = route.generateMetadata
