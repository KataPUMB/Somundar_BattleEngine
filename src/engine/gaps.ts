export interface RuleGapDef {
  id: string;
  ruleRef: string;
  question: string;
  assumption: string;
}

export const RULE_GAPS: readonly RuleGapDef[] = [
  { id: 'GAP-CREATURES', ruleRef: 'CANON-CREATURES (ausente)', question: 'Faltan fichas de especie (estadisticas NV50, tipos, lineas, FP, tecnicas aprendibles).', assumption: 'Criaturas individuales con estadisticas y tipos explicitos; no se valida el aprendizaje de tecnicas no especiales.' },
  { id: 'GAP-MULTIHIT-DIST', ruleRef: 'CANON-MECHANICS 19.4', question: 'Distribucion real de impactos en tecnicas 1-5.', assumption: 'Uniforme entre min y max (configurable).' },
  { id: 'GAP-ADEPT-SUSTAIN', ruleRef: 'CANON-MECHANICS 13.2 / 28.6.19', question: 'Como se decide si un Adepto sostiene la segunda posicion.', assumption: 'Parametro por invocador (maxRounds y/o chancePct); si falta, se sostiene 1 ronda.' },
  { id: 'GAP-ADEPT-DEPLOY', ruleRef: 'CANON-MECHANICS 13.2 / 13.4', question: 'Si un Adepto puede desplegar dos criaturas en el despliegue inicial.', assumption: 'No: la segunda posicion solo se abre al inicio de ronda.' },
  { id: 'GAP-ESPIRITU-DUAL', ruleRef: 'CANON-MECHANICS 24.9', question: 'Que son los beneficios de la combinacion dual.', assumption: 'Sin efecto hasta definirlos.' },
  { id: 'GAP-EMPTY-TARGET', ruleRef: 'CANON-MECHANICS 14.2 / 32', question: 'Tecnica dirigida a una posicion vacia al resolverse.', assumption: 'El impacto falla.' },
  { id: 'GAP-CONTACT', ruleRef: 'CANON-TECHNIQUES', question: 'Que tecnicas son de contacto.', assumption: 'Campo curado contact en overrides; sin curar = no contacto.' },
  { id: 'GAP-NONSTD-PARAMS', ruleRef: 'CANON-TECHNIQUES', question: 'Tecnicas con poder variable o precision no numerica.', assumption: 'Bloqueadas hasta tener handler.' },
  { id: 'GAP-NEXT-ROUND', ruleRef: 'CANON-TECHNIQUES', question: 'Duracion exacta de "hasta finalizar la siguiente ronda".', assumption: 'Expira al cierre de la ronda siguiente a su creacion.' },
  { id: 'GAP-ORDER-STATIC', ruleRef: 'CANON-MECHANICS 28.5.12-14', question: 'Si el orden de tecnicas se recalcula tras cambios de Velocidad durante la ronda.', assumption: 'Orden fijado al comenzar la fase de tecnicas.' },
  { id: 'GAP-TURN-PREDICATE', ruleRef: 'CANON-MECHANICS 24.2 / 28.6.18', question: 'Cuando una criatura ha tenido turno materializado en la ronda.', assumption: 'Si ocupaba posicion al declarar y sigue materializada al cierre. Una Salida reinicia la "tecnica del turno anterior" de Desorientado.' },
  { id: 'GAP-DOT-ROUNDING', ruleRef: 'CANON-MECHANICS 24.3', question: 'Redondeo de la perdida periodica de Quemado.', assumption: 'Redondeo al entero mas cercano, minimo 0.' },
  { id: 'GAP-ALL-TARGETS', ruleRef: 'CANON-TECHNIQUES Terminologia', question: 'Conjunto de "A todos" sin curar.', assumption: 'Todas las posiciones enemigas ocupadas (targetSet curado prevalece).' },
  { id: 'GAP-DOUBLE-KO', ruleRef: 'CANON-MECHANICS 26.2', question: 'Ambos invocadores pierden todas sus criaturas en la misma ronda.', assumption: 'Empate.' },
  { id: 'GAP-CHARGE-ACTIONS', ruleRef: 'CANON-MECHANICS 19.5', question: 'Acciones permitidas mientras se carga.', assumption: 'Solo ejecutar la carga o Intercambiar (la carga se pierde al salir).' },
  { id: 'GAP-ACC-STAGES', ruleRef: 'CANON-MECHANICS 20.2 / 21.2', question: 'Como se aplican etapas de Precision.', assumption: 'Se registran pero no modifican la Precision.' },
  { id: 'GAP-MULTI-OVERFLOW', ruleRef: 'CANON-MECHANICS 14.2 / 19.4', question: 'Reparto por impacto cuando hay mas impactos que asignaciones o la posicion esta vacia.', assumption: 'Los sobrantes van a la ultima posicion declarada; impactos contra posicion vacia se pierden.' },
  { id: 'GAP-TIE-GROUP', ruleRef: 'CANON-MECHANICS 18.3', question: 'Empates exactos entre tres o mas acciones.', assumption: 'Permutacion uniforme con RNG registrado.' },
  { id: 'GAP-ROUND-CAP', ruleRef: 'no canonico', question: 'Limite de rondas de simulacion.', assumption: 'maxRounds configurable; al alcanzarlo, empate por limite.' },
  { id: 'GAP-HP-START', ruleRef: 'CANON-MECHANICS 24.1 / 26.1', question: 'Si la Vitalidad perdida persiste entre combates (los estados si persisten).', assumption: 'Cada combate empieza con Vitalidad maxima salvo hpCurrent explicito en el escenario.' },
  { id: 'GAP-STATUS-REAPPLY', ruleRef: 'CANON-MECHANICS 24.1', question: 'Aplicar un estado que la criatura ya tiene.', assumption: 'Sin efecto: se conservan los contadores existentes.' },
  { id: 'GAP-EMPTY-POSITION-FILL', ruleRef: 'CANON-MECHANICS 1 (Materializacion en accion) / 15.1', question: 'Si se puede materializar una criatura completa en una posicion vacia ya existente.', assumption: 'Si, al establecer posiciones al inicio de ronda, ordenado por Velocidad como las del Adepto.' },
  { id: 'GAP-PARTIAL-FIRST-TURN', ruleRef: 'CANON-TECHNIQUES Puno preciso', question: 'Si una Materializacion parcial cuenta como "materializacion" para "solo funciona en el primer turno tras cada materializacion".', assumption: 'Si: usada mediante Materializacion parcial siempre cuenta como primer turno.' },
  { id: 'GAP-FLINCH', ruleRef: 'CANON-TECHNIQUES Puno preciso', question: 'Alcance de "lo hace retroceder y le impide actuar durante ese turno".', assumption: 'Se marca como efecto secundario; la accion pendiente falla y se consume; una carga en curso se conserva; si el objetivo ya actuo (incluida Esquiva) o no tiene accion pendiente, no hace nada.' },
  { id: 'GAP-ENV-ACTIVATION', ruleRef: 'CANON-MECHANICS 10.7 / 25.1', question: 'Cuando se activa una Manifestacion de Campo/Clima/Anomalia y cuanto dura.', assumption: 'Se activa con la Entrada de su portador y permanece hasta ser sustituida, aunque el portador salga.' },
  { id: 'GAP-HIT-EFFECTS', ruleRef: 'CANON-TECHNIQUES Terminologia (A todos)', question: 'Efectos al impactar de tecnicas multigolpe; efectos sobre objetivos ya derrotados.', assumption: 'Una vez por objetivo impactado salvo que el curado indique perHit; no se aplican a criaturas que ya no estan en el campo.' },
  { id: 'GAP-CHAIN-DEPTH', ruleRef: 'CANON-MECHANICS 10.10', question: 'Cadenas de respuestas sin fin.', assumption: 'Se corta al superar maxChainDepth y se registra.' },
];

export function gapById(id: string): RuleGapDef {
  const g = RULE_GAPS.find((x) => x.id === id);
  if (!g) throw new Error(`RuleGap desconocida: ${id}`);
  return g;
}
