import { useState } from 'react'
import type { TerminalSessionSnapshot } from '../../lib/runtime'

type TerminalRenameFieldProps = {
  session: TerminalSessionSnapshot
  onRename: (sessionId: number, nextName: string) => Promise<void>
}

export function TerminalRenameField({ session, onRename }: TerminalRenameFieldProps) {
  const [draftName, setDraftName] = useState(session.name)

  return (
    <label className="field-inline">
      <span className="label">Active Tab Name</span>
      <input
        aria-label="Active Tab Name"
        value={draftName}
        onChange={(event) => setDraftName(event.target.value)}
        onBlur={() => void onRename(session.sessionId, draftName)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            void onRename(session.sessionId, draftName)
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}
