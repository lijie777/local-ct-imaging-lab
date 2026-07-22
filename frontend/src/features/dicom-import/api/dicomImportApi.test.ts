import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDirectoryDicomFile, createDicomFile } from '../test/fileFixtures'
import {
  getSeriesDetails,
  importDicom,
  listPatientStudies,
  listStudySeries,
} from './dicomImportApi'


afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dicomImportApi', () => {
  it('posts every file as multipart and preserves directory display names', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          total: 2,
          success: 2,
          duplicate: 0,
          skipped: 0,
          unsupported: 0,
          failed: 0,
          items: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const plain = createDicomFile('plain.dcm')
    const directory = createDirectoryDicomFile('study/series/image.dcm')

    await importDicom('patient id', [plain, directory])

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/patients/patient%20id/dicom-import')
    expect(init.method).toBe('POST')
    expect(init.headers).toBeUndefined()
    expect(init.body).toBeInstanceOf(FormData)
    const submitted = (init.body as FormData).getAll('files') as File[]
    expect(submitted.map((file) => file.name)).toEqual([
      'plain.dcm',
      'study/series/image.dcm',
    ])
  })

  it('requests patient studies, study series, and series details with encoded ids', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await listPatientStudies('patient/id')
    await listStudySeries('study/id')
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'series',
          series_instance_uid: '1.2.3',
          modality: 'CT',
          series_number: 1,
          description: null,
          body_part_examined: null,
          rows: 2,
          columns: 2,
          instance_count: 0,
          viewability_status: 'eligible',
          viewability_reason: null,
          instances: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    await getSeriesDetails('series/id')

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/patients/patient%2Fid/studies',
      '/api/studies/study%2Fid/series',
      '/api/series/series%2Fid',
    ])
  })
})
