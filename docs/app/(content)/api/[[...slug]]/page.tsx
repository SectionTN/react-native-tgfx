import { createDocsRoute } from '@/lib/docs-page'

const route = createDocsRoute('api')

export default route.Page
export const generateStaticParams = route.generateStaticParams
export const generateMetadata = route.generateMetadata
