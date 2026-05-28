export function getRequiredRootElement(rootId: string): HTMLElement {
  const element = document.getElementById(rootId)

  if (!element) {
    throw new Error(`Missing application root element: #${rootId}`)
  }

  return element
}
