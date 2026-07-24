import { describe, expect, it } from 'vitest'

import {
  parseViewerStatePayload,
  parseViewerStateRead,
  VIEWER_STATE_MAX_BYTES,
  VIEWER_STATE_SCHEMA_VERSION,
} from './viewerState'


const VALID_PAYLOAD = {
  axial: {
    image_index: 2,
    active_tool: 'length',
    presentation: {
      zoom: 1.25,
      pan: [4, -2],
      rotation: 0,
      flip_horizontal: false,
      flip_vertical: false,
    },
    voi: { lower: -160, upper: 240, invert: false },
  },
  mpr: {
    active_viewport: 'coronal',
    active_tool: 'crosshairs',
    crosshairs_visible: true,
    crosshairs_position: [1, 2, 3],
    viewports: {
      axial: { presentation: null, voi: null },
      coronal: { presentation: null, voi: null },
      sagittal: { presentation: null, voi: null },
    },
  },
  annotations: [
    {
      viewport: 'axial',
      tool_name: 'Length',
      referenced_image_id: 'wadouri:http://127.0.0.1/api/instances/axial/file',
      points: [[0, 0, 0], [1, 1, 0]],
      label: null,
      text_box: null,
    },
    {
      viewport: 'coronal',
      tool_name: 'ArrowAnnotate',
      referenced_image_id: 'wadouri:http://127.0.0.1/api/instances/coronal/file',
      points: [[0, 0, 0], [1, 1, 1]],
      label: '教学标注',
      text_box: {
        has_moved: true,
        world_position: [1, 2, 3],
        world_bounding_box: {
          top_left: [0, 1, 0],
          top_right: [1, 1, 0],
          bottom_left: [0, 0, 0],
          bottom_right: [1, 0, 0],
        },
      },
    },
  ],
}

const VALID_READ = {
  series_id: '11111111-1111-4111-8111-111111111111',
  schema_version: VIEWER_STATE_SCHEMA_VERSION,
  state: VALID_PAYLOAD,
  created_at: '2026-07-23T01:00:00Z',
  updated_at: '2026-07-23T01:00:01Z',
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function payloadWithExactSerializedSize(targetBytes: number) {
  const payload = clone(VALID_PAYLOAD) as Record<string, any>
  const template = clone(VALID_PAYLOAD.annotations[0]) as Record<string, any>
  const fullIdentity = '影'.repeat(2048)
  payload.annotations = []

  while (payload.annotations.length < 500) {
    payload.annotations.push({
      ...clone(template),
      referenced_image_id: fullIdentity,
    })
    if (serializedBytes(payload) > targetBytes) {
      payload.annotations.pop()
      break
    }
  }

  const finalAnnotation = {
    ...clone(template),
    referenced_image_id: '',
  }
  payload.annotations.push(finalAnnotation)
  let remainingBytes = targetBytes - serializedBytes(payload)
  const multibyteCharacters = Math.floor(remainingBytes / 3)
  finalAnnotation.referenced_image_id = '影'.repeat(multibyteCharacters)
  remainingBytes = targetBytes - serializedBytes(payload)
  finalAnnotation.referenced_image_id += 'x'.repeat(remainingBytes)

  expect(finalAnnotation.referenced_image_id.length).toBeLessThanOrEqual(2048)
  expect(serializedBytes(payload)).toBe(targetBytes)
  return payload
}

describe('viewer state codec', () => {
  it('defensively parses and clones a valid v1 response', () => {
    const parsed = parseViewerStateRead(VALID_READ)

    expect(parsed).toEqual(VALID_READ)
    expect(parsed).not.toBe(VALID_READ)
    expect(parsed?.state).not.toBe(VALID_READ.state)
  })

  it('accepts a missing state response', () => {
    expect(parseViewerStateRead(null)).toBeNull()
  })

  it.each([
    ['unknown root key', { ...VALID_READ, private_path: 'D:/private' }],
    ['unknown version', { ...VALID_READ, schema_version: 2 }],
    ['unknown payload key', { ...VALID_READ, state: { ...VALID_PAYLOAD, extra: true } }],
    [
      'unknown active tool',
      {
        ...VALID_READ,
        state: {
          ...VALID_PAYLOAD,
          axial: { ...VALID_PAYLOAD.axial, active_tool: 'Crosshairs' },
        },
      },
    ],
    [
      'unknown annotation tool',
      {
        ...VALID_READ,
        state: {
          ...VALID_PAYLOAD,
          annotations: [{ ...VALID_PAYLOAD.annotations[0], tool_name: 'Crosshairs' }],
        },
      },
    ],
  ])('rejects %s', (_label, value) => {
    expect(() => parseViewerStateRead(value)).toThrow()
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite number %s',
    (value) => {
      const input = clone(VALID_PAYLOAD)
      input.axial.presentation.zoom = value
      expect(() => parseViewerStatePayload(input)).toThrow()
    },
  )

  it('rejects invalid vector lengths, point counts, VOI, and non-arrow labels', () => {
    const badPan = clone(VALID_PAYLOAD) as Record<string, any>
    badPan.axial.presentation.pan = [1]
    expect(() => parseViewerStatePayload(badPan)).toThrow()

    const badPoints = clone(VALID_PAYLOAD) as Record<string, any>
    badPoints.annotations[0].points = [[0, 0, 0]]
    expect(() => parseViewerStatePayload(badPoints)).toThrow()

    const badVoi = clone(VALID_PAYLOAD) as Record<string, any>
    badVoi.axial.voi = { lower: 20, upper: 10, invert: false }
    expect(() => parseViewerStatePayload(badVoi)).toThrow()

    const badLabel = clone(VALID_PAYLOAD) as Record<string, any>
    badLabel.annotations[0].label = 'not allowed'
    expect(() => parseViewerStatePayload(badLabel)).toThrow()

    const missingImageIdentity = clone(VALID_PAYLOAD) as Record<string, any>
    delete missingImageIdentity.annotations[0].referenced_image_id
    expect(() => parseViewerStatePayload(missingImageIdentity)).toThrow()
  })

  it('normalizes safe Arrow text and rejects empty, control, and overlong text', () => {
    const normalized = clone(VALID_PAYLOAD) as Record<string, any>
    normalized.annotations[1].label = '  教学标注  '
    expect(parseViewerStatePayload(normalized).annotations[1].label).toBe('教学标注')

    for (const label of ['', 'line\nbreak', 'x'.repeat(201)]) {
      const input = clone(VALID_PAYLOAD) as Record<string, any>
      input.annotations[1].label = label
      expect(() => parseViewerStatePayload(input)).toThrow()
    }
  })

  it('enforces 500 annotations and the 2 MiB serialized boundary', () => {
    const fiveHundred = clone(VALID_PAYLOAD) as Record<string, any>
    fiveHundred.annotations = Array.from(
      { length: 500 },
      () => clone(VALID_PAYLOAD.annotations[0]),
    )
    expect(parseViewerStatePayload(fiveHundred).annotations).toHaveLength(500)

    fiveHundred.annotations.push(clone(VALID_PAYLOAD.annotations[0]))
    expect(() => parseViewerStatePayload(fiveHundred)).toThrow()

    const oversized = { ...VALID_PAYLOAD, ignored: 'x'.repeat(2 * 1024 * 1024) }
    expect(() => parseViewerStatePayload(oversized)).toThrow()
  })

  it('applies the 2 MiB limit to state instead of the response envelope', () => {
    const state = payloadWithExactSerializedSize(VIEWER_STATE_MAX_BYTES)
    const response = { ...VALID_READ, state }

    expect(serializedBytes(response)).toBeGreaterThan(VIEWER_STATE_MAX_BYTES)
    expect(parseViewerStatePayload(state).annotations).toHaveLength(
      state.annotations.length,
    )
    expect(parseViewerStateRead(response)?.state.annotations).toHaveLength(
      state.annotations.length,
    )
  })
})
