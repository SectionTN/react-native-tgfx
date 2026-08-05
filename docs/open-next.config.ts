import { defineCloudflareConfig } from '@opennextjs/cloudflare'
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache'

// Every page is prerendered, so the output ships as static assets read through ASSETS.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
})
