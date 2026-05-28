import { getRequiredRootElement } from '../../shared/lib/dom/get-root-element'
import type {
  LegacyPrototypeModule,
  LegacyPrototypeMountOptions,
} from '../../shared/types/legacy-prototype'

export async function mountLegacyPrototype(
  options: LegacyPrototypeMountOptions = {},
): Promise<LegacyPrototypeModule> {
  getRequiredRootElement(options.rootId ?? 'root')

  return import('../../prototype.jsx') as Promise<LegacyPrototypeModule>
}
