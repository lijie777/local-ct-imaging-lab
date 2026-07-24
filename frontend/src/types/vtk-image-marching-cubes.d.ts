declare module '@kitware/vtk.js/Filters/General/ImageMarchingCubes' {
  import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData'
  import type vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData'
  import type { vtkAlgorithm } from '@kitware/vtk.js/interfaces'

  interface vtkImageMarchingCubes extends vtkAlgorithm {
    delete(): void
    getOutputData(): vtkPolyData
    setComputeNormals(value: boolean): boolean
    setContourValue(value: number): boolean
    setInputData(value: vtkImageData): void
    setMergePoints(value: boolean): boolean
  }

  const vtkImageMarchingCubes: {
    newInstance(): vtkImageMarchingCubes
  }

  export default vtkImageMarchingCubes
}
