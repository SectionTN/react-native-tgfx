import { Accordion, Accordions } from 'fumadocs-ui/components/accordion'
import { Callout, CalloutDescription } from 'fumadocs-ui/components/callout'
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock'
import * as FilesComponents from 'fumadocs-ui/components/files'
import * as TabsComponents from 'fumadocs-ui/components/tabs'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'
import type { ComponentProps } from 'react'
import { MdxCalloutContainer, MdxCalloutTitle } from '@/lib/mdx/callouts'
import { MdxImage } from '@/lib/mdx/images'
import type { MdxComponentOptions } from '@/lib/mdx/types'
import { mergeClassNames } from '@/lib/mdx/utils'

type CodeBlockRendererProps = ComponentProps<'pre'> &
  Partial<ComponentProps<typeof CodeBlock>>

export function getMDXComponents(
  components?: MDXComponents,
  options?: MdxComponentOptions,
): MDXComponents {
  const codeBlock = options?.codeBlock

  return {
    ...defaultMdxComponents,
    ...TabsComponents,
    ...FilesComponents,
    ...components,
    pre: ({
      children,
      className,
      viewportProps,
      ...props
    }: CodeBlockRendererProps) => (
      <CodeBlock
        {...props}
        className={mergeClassNames(className, codeBlock?.className)}
        viewportProps={{
          ...viewportProps,
          className: mergeClassNames(
            viewportProps?.className,
            codeBlock?.viewportClassName,
          ),
        }}
      >
        <Pre className={codeBlock?.preClassName}>{children}</Pre>
      </CodeBlock>
    ),
    Accordion,
    Accordions,
    Callout,
    'callout-root': MdxCalloutContainer,
    'callout-title': MdxCalloutTitle,
    'callout-body': CalloutDescription,
    img: MdxImage,
  } satisfies MDXComponents
}
