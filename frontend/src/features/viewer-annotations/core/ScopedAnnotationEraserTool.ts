type ToolsModule = typeof import('@cornerstonejs/tools')

interface InteractionEvent {
  detail: {
    currentPoints: { canvas: readonly [number, number] }
    element: HTMLDivElement
    renderingEngineId: string
    viewportId: string
  }
  preventDefault(): void
}

interface AnnotationLike {
  annotationUID?: string
}

interface InteractableTool {
  filterInteractableAnnotationsForElement(
    element: HTMLDivElement,
    annotations: AnnotationLike[],
  ): AnnotationLike[] | undefined
  isPointNearTool(
    element: HTMLDivElement,
    annotation: AnnotationLike,
    canvasPoint: readonly [number, number],
    proximity: number,
    interactionType: string,
  ): boolean
}

export const SCOPED_ERASER_TOOL_NAME = 'ScopedAnnotationEraser'

export function scopedEraserToolClass(tools: ToolsModule) {
  const allowedToolNames = [
    tools.LengthTool.toolName,
    tools.AngleTool.toolName,
    tools.RectangleROITool.toolName,
    tools.ArrowAnnotateTool.toolName,
  ]

  return class ScopedAnnotationEraserTool extends tools.BaseTool {
    static toolName = SCOPED_ERASER_TOOL_NAME

    constructor(
      toolProps: ConstructorParameters<ToolsModule['BaseTool']>[0] = {},
    ) {
      super(toolProps, { supportedInteractionTypes: ['Mouse', 'Touch'] })
    }

    preMouseDownCallback = (event: InteractionEvent): boolean =>
      this.deleteAllowedAnnotation(event, 'mouse')

    preTouchStartCallback = (event: InteractionEvent): boolean =>
      this.deleteAllowedAnnotation(event, 'touch')

    private deleteAllowedAnnotation(
      event: InteractionEvent,
      interactionType: string,
    ): boolean {
      const { currentPoints, element, renderingEngineId, viewportId } = event.detail
      const toolGroup = tools.ToolGroupManager.getToolGroupForViewport(
        viewportId,
        renderingEngineId,
      ) ?? tools.ToolGroupManager.getToolGroup(this.toolGroupId)
      if (toolGroup === undefined) {
        return false
      }

      for (const toolName of allowedToolNames) {
        const tool = toolGroup.getToolInstance(toolName) as
          | InteractableTool
          | undefined
        if (
          tool === undefined ||
          typeof tool.filterInteractableAnnotationsForElement !== 'function' ||
          typeof tool.isPointNearTool !== 'function'
        ) {
          continue
        }
        const annotations = tools.annotation.state.getAnnotations(
          toolName,
          element,
        ) as AnnotationLike[]
        const interactable = tool.filterInteractableAnnotationsForElement(
          element,
          annotations,
        ) ?? []
        for (const annotation of [...interactable].reverse()) {
          if (
            typeof annotation.annotationUID === 'string' &&
            tool.isPointNearTool(
              element,
              annotation,
              currentPoints.canvas,
              10,
              interactionType,
            )
          ) {
            tools.annotation.state.removeAnnotation(annotation.annotationUID)
            tools.utilities.triggerAnnotationRender(element)
            event.preventDefault()
            return true
          }
        }
      }
      return false
    }
  }
}
