import type {
  Callout,
  NodeOptions,
  Options as RemarkCalloutOptions,
} from '@r4ai/remark-callout'
import remarkCallout from '@r4ai/remark-callout'
import { defineConfig, defineDocs, metaSchema } from 'fumadocs-mdx/config'

function normalizeCalloutType(callout: Callout): string {
  const type = callout.type.toLowerCase()
  return type === 'important' ? 'info' : type
}

function createCalloutNode(tagName: string, callout: Callout): NodeOptions {
  return {
    tagName,
    properties: {
      type: normalizeCalloutType(callout),
    },
  }
}

// GitHub-style `> [!NOTE]` blockquotes render through the same callout
// components as `<Callout>`.
const remarkCalloutOptions: RemarkCalloutOptions = {
  root: (callout) => createCalloutNode('callout-root', callout),
  title: (callout) => createCalloutNode('callout-title', callout),
  body: () => ({
    tagName: 'callout-body',
    properties: {},
  }),
}

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
})

export const apiReference = defineDocs({
  dir: 'content/api',
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
})

export default defineConfig({
  mdxOptions: {
    remarkNpmOptions: {
      persist: {
        id: 'package-manager',
      },
    },
    remarkPlugins: [[remarkCallout, remarkCalloutOptions]],
  },
})
