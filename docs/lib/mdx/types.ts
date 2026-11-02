import type { ImageZoomProps } from 'fumadocs-ui/components/image-zoom'
import type { ComponentProps, CSSProperties } from 'react'

export type CodeBlockDisplayOptions = {
  className?: string
  preClassName?: string
  viewportClassName?: string
}

export type MdxComponentOptions = {
  codeBlock?: CodeBlockDisplayOptions
}

export type CalloutStyle = CSSProperties & {
  '--callout-color'?: string
}

export type StaticImageLike = {
  src: string
  width: number
  height: number
  blurDataURL?: string
  blurWidth?: number
  blurHeight?: number
}

export type ResolvedImageSrc = NonNullable<ImageZoomProps['src']>

export type ImportedMdxImageSource = {
  default: ResolvedImageSrc
}

export type MdxImageSource =
  | ComponentProps<'img'>['src']
  | ResolvedImageSrc
  | ImportedMdxImageSource
  | URL

export type MdxImageProps = Omit<ComponentProps<'img'>, 'src'> & {
  src?: MdxImageSource
}
