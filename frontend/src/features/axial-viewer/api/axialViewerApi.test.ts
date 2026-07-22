import { expect, it } from 'vitest'

import { instanceImageId } from './axialViewerApi'


it('builds a same-origin wadouri image id from an instance resource id', () => {
  expect(instanceImageId('instance id/1')).toBe(
    `wadouri:${window.location.origin}/api/instances/instance%20id%2F1/file`,
  )
})

it('does not accept a caller-provided remote origin', () => {
  expect(instanceImageId('https://remote.example/image.dcm')).toBe(
    `wadouri:${window.location.origin}/api/instances/https%3A%2F%2Fremote.example%2Fimage.dcm/file`,
  )
})
