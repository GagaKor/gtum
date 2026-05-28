import { mountLegacyPrototype } from './providers/legacy-prototype'

void mountLegacyPrototype({ rootId: 'root' }).catch((error: unknown) => {
  console.error('[gtum] failed to mount frontend shell', error)
})
