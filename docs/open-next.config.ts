import { defineCloudflareConfig } from '@opennextjs/cloudflare'
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache'

// Every page here is prerendered, so the prerender output ships as static assets
// and is read back through the ASSETS binding. No R2 or KV needed.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
})
