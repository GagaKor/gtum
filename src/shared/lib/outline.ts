import type { ProjectFileSnapshot } from '../../lib/runtime'

export type OutlineEntry = {
  id: string
  label: string
  lineNumber: number
  depth: number
  kind: 'heading' | 'class' | 'function' | 'component' | 'const'
}

const OUTLINE_LIMIT = 48

const pushEntry = (
  entries: OutlineEntry[],
  kind: OutlineEntry['kind'],
  label: string,
  lineNumber: number,
  depth = 0,
) => {
  if (!label.trim() || entries.length >= OUTLINE_LIMIT) {
    return
  }

  entries.push({
    id: `${kind}-${lineNumber}-${label}`,
    label: label.trim(),
    lineNumber,
    depth,
    kind,
  })
}

export const buildOutlineEntries = (file: ProjectFileSnapshot | null): OutlineEntry[] => {
  if (!file?.isText) {
    return []
  }

  const entries: OutlineEntry[] = []

  file.content.split('\n').forEach((line, index) => {
    const lineNumber = index + 1
    const trimmed = line.trim()

    if (!trimmed) {
      return
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      pushEntry(entries, 'heading', heading[2], lineNumber, heading[1].length - 1)
      return
    }

    const classMatch = trimmed.match(/^(?:export\s+)?class\s+([A-Za-z0-9_]+)/)
    if (classMatch) {
      pushEntry(entries, 'class', classMatch[1], lineNumber)
      return
    }

    const functionMatch = trimmed.match(/^(?:export\s+)?function\s+([A-Za-z0-9_]+)/)
    if (functionMatch) {
      pushEntry(entries, 'function', functionMatch[1], lineNumber)
      return
    }

    const constMatch = trimmed.match(
      /^(?:export\s+)?const\s+([A-Z][A-Za-z0-9_]*|[a-z][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?(?:\(|<|function\b)/,
    )
    if (constMatch) {
      const kind = /^[A-Z]/.test(constMatch[1]) ? 'component' : 'const'
      pushEntry(entries, kind, constMatch[1], lineNumber)
      return
    }

    const arrowComponentMatch = trimmed.match(
      /^(?:export\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:memo\(|forwardRef\(|\()/,
    )
    if (arrowComponentMatch) {
      pushEntry(entries, 'component', arrowComponentMatch[1], lineNumber)
    }
  })

  return entries
}
