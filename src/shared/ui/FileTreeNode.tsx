import type { FileTreeNode } from '../../lib/runtime'

type FileTreeNodeProps = {
  node: FileTreeNode
  depth?: number
  selectedFilePath: string | null
  onSelectFile: (node: FileTreeNode) => void
}

export function FileTreeNodeView({
  node,
  depth = 0,
  selectedFilePath,
  onSelectFile,
}: FileTreeNodeProps) {
  const isSelected = node.kind === 'file' && node.path === selectedFilePath

  return (
    <li>
      {node.kind === 'file' ? (
        <button
          type="button"
          className={`tree-row tree-button ${node.kind} ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: `${depth * 14}px` }}
          onClick={() => onSelectFile(node)}
          aria-pressed={isSelected}
        >
          <span className="tree-icon">·</span>
          <span className="tree-name">{node.name}</span>
          {node.truncated ? <span className="tree-meta">depth limit</span> : null}
        </button>
      ) : (
        <div className={`tree-row ${node.kind}`} style={{ paddingLeft: `${depth * 14}px` }}>
          <span className="tree-icon">▸</span>
          <span className="tree-name">{node.name}</span>
          {node.truncated ? <span className="tree-meta">depth limit</span> : null}
        </div>
      )}
      {node.children.length > 0 ? (
        <ul className="tree-list">
          {node.children.map((child) => (
            <FileTreeNodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFilePath={selectedFilePath}
              onSelectFile={onSelectFile}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
