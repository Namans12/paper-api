import { createContext, useContext } from 'react';
import type { RGBA } from '../sheet/raster';

export type ImportSource = 'upload' | 'fixture';
export interface PendingImport { img: RGBA; source: ImportSource; key: number }
interface ImportCtx { startImport(img: RGBA, source: ImportSource): void }

export const ImportContext = createContext<ImportCtx | null>(null);

export function useImport(): ImportCtx {
  const v = useContext(ImportContext);
  if (!v) throw new Error('useImport outside ImportContext.Provider');
  return v;
}
