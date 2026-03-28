import type { FileTreeNode, ProjectFileSnapshot } from '../../lib/runtime'

export type ParsedLineReference = {
  filePath: string
  lineNumber: number
  label: string
}

const lineReferencePattern = /((?:[A-Za-z]:)?[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+):(\d+)(?::\d+)?/

export const extractLineReference = (value: string): ParsedLineReference | null => {
  const match = value.match(lineReferencePattern)

  if (!match) {
    return null
  }

  const lineNumber = Number(match[2])
  if (!Number.isFinite(lineNumber) || lineNumber <= 0) {
    return null
  }

  return {
    filePath: match[1],
    lineNumber,
    label: `${match[1].replace(/\\/g, '/')}:L${lineNumber}`,
  }
}

export const buildDisplayFileAnchor = (displayPath: string | null, lineNumber: number | null) => {
  if (!displayPath) {
    return 'No selected file'
  }

  return lineNumber && lineNumber > 0 ? `${displayPath}:L${lineNumber}` : displayPath
}

export const clampLineNumber = (lineNumber: number | null, maxLines: number) => {
  if (!lineNumber || lineNumber <= 0 || maxLines <= 0) {
    return null
  }

  return Math.min(lineNumber, maxLines)
}

const treeContainsPath = (node: FileTreeNode, targetPath: string): boolean => {
  if (node.path === targetPath) {
    return true
  }

  return node.children.some((child) => treeContainsPath(child, targetPath))
}

export const findFirstFilePath = (node: FileTreeNode): string | null => {
  if (node.kind === 'file') {
    return node.path
  }

  for (const child of node.children) {
    const nextMatch = findFirstFilePath(child)
    if (nextMatch) {
      return nextMatch
    }
  }

  return null
}

export const resolveSelectedFilePath = (tree: FileTreeNode, preferredPath: string | null): string | null => {
  if (preferredPath && treeContainsPath(tree, preferredPath)) {
    return preferredPath
  }

  return findFirstFilePath(tree)
}

export const buildFileSnippet = (
  file: ProjectFileSnapshot | null,
  lineNumber: number | null = null,
  maxLines = 24,
  maxChars = 1800,
) => {
  if (!file?.isText || !file.content.trim()) {
    return null
  }

  const lines = file.content.split('\n')
  const normalizedLineNumber = clampLineNumber(lineNumber, lines.length)
  const start = normalizedLineNumber
    ? Math.max(0, normalizedLineNumber - Math.min(6, maxLines) - 1)
    : 0
  const end = Math.min(lines.length, start + (normalizedLineNumber ? 12 : maxLines))
  const snippet = lines
    .slice(start, end)
    .map((line, index) => `${start + index + 1}: ${line}`)
    .join('\n')

  return snippet.length > maxChars ? `${snippet.slice(0, maxChars).trimEnd()}\n...` : snippet
}

export const formatFileSizeLabel = (sizeBytes: number) => {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
  }

  if (sizeBytes >= 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`
  }

  return `${sizeBytes} B`
}
