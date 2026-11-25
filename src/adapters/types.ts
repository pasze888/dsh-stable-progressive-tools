import type { PresentationMode, SessionSurface } from '../surface.ts'

export interface PresentationRequest {
  readonly surface: SessionSurface
  readonly history: readonly unknown[]
}

export interface PresentationAdapter {
  readonly mode: PresentationMode
  present(request: PresentationRequest): Promise<unknown>
}
