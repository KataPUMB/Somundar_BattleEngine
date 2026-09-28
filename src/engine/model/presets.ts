import type { Estamento, Simultaneity, Summoner } from './types.js';

export interface EstamentoPreset {
  amplitude: number | null;
  fortalezaCapacity: number;
  fortalezaMaxPerStat: number;
  simultaneity: Simultaneity;
  partialMaterialization: boolean;
}

// Referencias habituales, nunca llaves (CANON-MECHANICS 2.1, 8.5, 9.4, 11)
export const ESTAMENTO_PRESETS: Record<Estamento, EstamentoPreset> = {
  despertado: { amplitude: 100, fortalezaCapacity: 10, fortalezaMaxPerStat: 5, simultaneity: 'single', partialMaterialization: false },
  iniciado: { amplitude: 150, fortalezaCapacity: 20, fortalezaMaxPerStat: 10, simultaneity: 'single', partialMaterialization: false },
  adepto: { amplitude: 200, fortalezaCapacity: 30, fortalezaMaxPerStat: 15, simultaneity: 'adept_temporary', partialMaterialization: false },
  invocador: { amplitude: 250, fortalezaCapacity: 40, fortalezaMaxPerStat: 20, simultaneity: 'stable', partialMaterialization: true },
  magister: { amplitude: 300, fortalezaCapacity: 50, fortalezaMaxPerStat: 25, simultaneity: 'stable', partialMaterialization: true },
  arconte: { amplitude: null, fortalezaCapacity: 60, fortalezaMaxPerStat: 25, simultaneity: 'stable', partialMaterialization: true },
};

export function summonerFromPreset(
  id: string,
  name: string,
  estamento: Estamento,
  overrides: Partial<Omit<Summoner, 'id' | 'name' | 'estamento'>> = {},
): Summoner {
  return { id, name, estamento, manifestationRepertoire: [], ...ESTAMENTO_PRESETS[estamento], ...overrides };
}
