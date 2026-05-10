type AnnotationActions = {
  clearAnnotations(): void
}

export function clearBrowserAnnotations(annotations: AnnotationActions) {
  annotations.clearAnnotations()
  void window.api?.browser?.clearAnnotationMarkers?.().catch(() => undefined)
}
