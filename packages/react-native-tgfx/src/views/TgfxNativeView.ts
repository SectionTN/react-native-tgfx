import { getHostComponent, type HybridRef } from 'react-native-nitro-modules'
import TgfxViewConfig from '../../nitrogen/generated/shared/json/TgfxViewConfig.json'
import type { TgfxViewMethods, TgfxViewProps } from '../specs/TgfxView.nitro'

/**
 * The raw Nitro host component for the native tgfx canvas. Most users render the
 * higher-level {@link Canvas} instead, but this is exported so advanced callers
 * can drive `scene` / `valuesBuffer` and the `hybridRef` directly.
 */
export const TgfxNativeView = getHostComponent<TgfxViewProps, TgfxViewMethods>(
  'TgfxView',
  () => TgfxViewConfig
)

export type TgfxViewRef = HybridRef<TgfxViewProps, TgfxViewMethods>
