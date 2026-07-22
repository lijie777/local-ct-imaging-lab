import { expect, it } from 'vitest'
import type { UserConfig } from 'vite'

import viteConfig from './vite.config'


it('prebundles the CommonJS Cornerstone codec entry points used by the DICOM worker', () => {
  const config = viteConfig as UserConfig

  expect(config.optimizeDeps?.include).toEqual(
    expect.arrayContaining([
      '@cornerstonejs/codec-charls/decodewasmjs',
      '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs',
      '@cornerstonejs/codec-openjpeg/decodewasmjs',
      '@cornerstonejs/codec-openjph/wasmjs',
    ]),
  )
})
