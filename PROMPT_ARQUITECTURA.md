# Prompt de arquitectura — Simulador de combates de Somundar

## 0. Rol y objetivo

Actúa como arquitecto/a e ingeniero/a principal. Diseña e implementa un **simulador de combates de invocación de Somundar** que resuelva duelos de forma **determinista, reproducible y auditable**, aplicando literalmente las normas de `NarrativeEngine/05_SISTEMA_DE_INVOCACION.md` (CANON-MECHANICS, CANON-TECHNIQUES y CANON-MANIFESTATIONS, revisión activa r2) y usando como base de datos los JSON de `Data/`.

El simulador no es un videojuego libre: es un **árbitro**. Nunca inventa reglas. Si una situación no está cubierta, lo declara como laguna (`RuleGap`), la hace configurable y la registra en el log.

Stack: **[ELEGIR — recomendado TypeScript estricto + Node para el motor, con UI web opcional; motor sin dependencias de UI]**.

---

## 1. Fuentes de verdad y precedencia

1. **CANON-MECHANICS** gobierna la resolución general (orden, fórmulas, estados, límites). Si otra fuente contradice una regla mecánica, prevalece CANON-MECHANICS.
2. **CANON-TECHNIQUES** y **CANON-MANIFESTATIONS** definen efectos particulares y excepciones expresas. Una excepción explícita de una técnica/Manifestación prevalece sobre la regla general sólo en lo que dice literalmente.
3. En `Data/*.json`, el campo `description` (técnicas) / `text` (Manifestaciones) es **autoritativo**. El campo `mechanics` es una **extracción asistida e incompleta**: sirve de punto de partida, nunca de verdad final.
4. Las Preparaciones de personajes de CANON-NOVELS (dossier) pueden usarse como **escenarios de prueba**, no como reglas.
5. Conflicto conocido: la terminología de los compendios dice «baja = -1 etapa (-50%)», pero la tabla de etapas de CANON-MECHANICS 21.2 fija -1 = ×0,667. **Usa siempre la tabla 21.2** (ISS-004).

---

## 2. Base de datos (`Data/`)

Generada por `tools/build_data.py` (re-ejecutable). Esquemas actuales:

| Fichero | Contenido | Estado |
|---|---|---|
| `techniques.json` | 343 técnicas: `id, name, category (anatomical/elemental/no_element/special), type, class (physical/magical/status), power {base, perHit, hits{min,max}, effective}, accuracy, bondCost, priority, targeting (single/multi/all), rarity, species, description, mechanics, source` | Completo en parámetros; efectos por curar |
| `manifestations.json` | 138 Manifestaciones: `id, name, element (tipo o "global"), rarity, label, trigger, environmentKind, effect[], text, mechanics, notes, source` | Completo en texto; efectos por curar |
| `types.json` | Tabla 9×9 `effectiveness[atacante][defensor]`, inmunidades por tipo, regla duotipo | Completo |
| `status_conditions.json` | 8 problemas de estado con modificadores, restricciones y contadores; reglas de coexistencia | Completo |
| `creatures.json` | 160 especies (número, nombre, técnicas especiales); tipos sólo para 20 | **Incompleto**: falta CANON-CREATURES (`04_CRIATURAS.md`): estadísticas NV50, tipos, líneas de Transfiguración, FP, anatomía, técnicas aprendibles |

Requisitos del cargador:
- Validar esquemas al arrancar (IDs únicos, referencias cruzadas técnica->especie, tipos válidos, costes múltiplos de 6,25, prioridad en [-6, +3]).
- Permitir un fichero de **overrides curados** (`Data/effects/*.json`) que añada el campo `effects` (DSL, §7) por técnica/Manifestación sin tocar los JSON generados.
- Emitir un **informe de cobertura**: qué técnicas/Manifestaciones tienen efectos implementados, cuáles se ejecutan sólo con daño base y cuáles están bloqueadas.
- Permitir definir **criaturas individuales** (instancias) con estadísticas explícitas mientras no exista CANON-CREATURES.

---

## 3. Arquitectura por capas

```
ui/ (opcional)          CLI, visor web de combates, editor de Preparaciones
app/                    casos de uso: validar Preparación, simular, repetir, lote de simulaciones
engine/
  model/                entidades inmutables del estado de combate
  rules/                fórmulas puras (estadísticas, daño, precisión, tipos, etapas, profundidad)
  pipeline/             orquestador de ronda (28.1–28.6), cola de cadenas, ordenación
  effects/              DSL, registro de disparadores, intérprete, handlers especiales
  legality/             validadores de Preparación y de acciones
  ai/                   políticas de declaración
  log/                  eventos estructurados, trazas causales, exportación narrativa
data/                   cargadores, validación, overrides
tests/                  unitarios, escenarios canónicos, propiedades
```

Principios:
- **Motor puro**: `nextState = resolve(state, declarations, rng)`. Sin E/S, sin reloj, sin aleatoriedad global.
- **RNG con semilla** inyectado; cada tirada se registra (`{purpose, roll, threshold, result}`) para poder reproducir y auditar.
- Estado **inmutable** (o con copia estructural) para permitir deshacer, repetir y búsqueda de IA.
- Toda regla implementada lleva la referencia de sección (`// CANON-MECHANICS 16.3`) en una línea.

---

## 4. Modelo de dominio

### 4.1. Invocador (`Summoner`)
- `estamento`: Despertado | Iniciado | Adepto | Invocador | Magíster | Arconte. **Sólo describe**; no desbloquea nada (2.1, 11). Las capacidades son campos explícitos con presets por estamento:
  - `amplitude` (100/150/200/250/300/400-sin límite global; Arconte = sin restricción global, 8.5–8.6).
  - `fortalezaCapacity` y `fortalezaMaxPerStat` (10/5, 20/10, 30/15, 40/20, 50/25, 60/25; 9.4).
  - `simultaneity`: `single` | `adept_temporary` | `stable` (máximo absoluto 2; 12.1).
  - `partialMaterialization`: booleano (habitual desde Invocador; 11.4).
  - `manifestationRepertoire`: IDs conocidos (el repertorio, no copias).
- Sin Vitalidad propia en duelo formal (27.1). Combate real queda fuera de alcance inicial (27.2–27.3), pero el modelo debe permitir añadirlo.

### 4.2. Criatura vinculada (`BondedCreature`)
- `speciesId`, `form` (forma actual de la línea), `types` (1–2), `nv` (1–100), `depth`, `depthFactor`.
- `fortaleza`: puntos enteros por estadística; máx. +25 por estadística y suma <= capacidad del invocador (9.3–9.4). `orientations`: máx. 2 (no dan mejora por sí mismas).
- `baseStatsNV50`: `hp, atk, matk, def, mdef, spe`.
- `equippedTechniques`: máx. 4, coste total <= 100 (8.1–8.2).
- `equippedManifestations`: 1 si NV <= 49; 2 si NV >= 50 (10.2).
- `persistentStatuses` con contadores (persisten entre combates; 24.1, 36).
- Invariante: un invocador no puede tener Vínculo con dos individuos de la misma línea de Transfiguración (2.5).

### 4.3. Preparación (`Preparation`)
- Máx. 4 criaturas (7.1). Sólo criaturas preparadas pueden materializarse, sustituir o actuar (7.2).
- Suma de `bondCost` de todas las técnicas equipadas <= `amplitude` (8.5), salvo Arconte (8.6).
- Manifestaciones: compatibilidad elemental (su elemento debe estar entre los tipos de la criatura; Globales en cualquiera; 10.3) y **equipamiento único** en toda la Preparación (10.4).
- Se compromete al iniciar el combate; no puede cambiarse durante él (7.3, 13.1). Cambiarla no redistribuye Fortaleza.
- El validador devuelve **todos** los errores con referencia de sección, no sólo el primero.

### 4.4. Estado de combate (`BattleState`)
- `sides[2]`: invocador, Preparación, `positions` (1 o 2; `occupant` o vacía), reservas viables, derrotadas, efectos laterales (Barreras, Estela, Zona antimagia… con rondas restantes).
- `environment`: **un único** Campo/Clima/Anomalía global activo (25.1), con su origen.
- Por criatura en combate: Vitalidad actual, etapas (-6..+6) por estadística y Precisión, estados, contadores de turnos materializados, `dodgeStreak`, técnica cargando, última técnica usada, técnica bloqueada (Amartillar/Concentración/Ataque Rápido), marcas (Rastro, Acecho, Presagio Imposible, Marcado por la Muerte…), flags de «primera vez» (Versatilidad, Segundo Aliento, Puño preciso, Último recurso).
- `round`, `chainQueue`, `rngState`, `eventLog`.

---

## 5. Fórmulas (módulo `rules/`, funciones puras y testeadas)

- **Factor de Nivel**: `2/3 + NV/150` (5.1).
- **Estadística estable**: `round(statNV50 × factorNivel × (1 + fortaleza/100))`, redondeo **una sola vez** (21.1). Vitalidad usa la misma curva.
- **Etapas** (21.2): +1 ×1,5 · +2 ×2 · +3 ×2,5 · +4 ×3 · +5 ×3,5 · +6 ×4 · -1 ×0,667 · -2 ×0,5 · -3 ×0,4 · -4 ×0,333 · -5 ×0,286 · -6 ×0,25. Límite [-6, +6].
- **Estadística efectiva** (21.3): `max(1, estable × etapa × max(0, 1 + suma de modificadores directos))`. Antes de sumar, de los **problemas de estado** sólo cuenta la penalización más severa **por estadística**; los demás modificadores (técnicas, Manifestaciones, campos) se suman normalmente.
- **Precisión** (20.2): `clamp(0, 100, base × (1 + suma relativos) + puntos porcentuales)`. PB < 100 -> 100% base salvo ficha; PB >= 100 usa la ficha (20.1). «Nunca falla» ignora reducciones ordinarias (20.3).
- **Daño** (23.1): `0,75 × (PB/100) × Ataque × sqrt(Ataque/Defensa) × M × T / R`.
  - Física: Ataque físico vs Defensa; Mágica: Ataque mágico vs Defensa mágica (19.1–19.2). Excepciones de ficha (p. ej. usar Defensa como ataque).
  - `M = max(0, 1 + suma de % de daño)` (23.2). «Daño recibido -X%» suma en M; «reduce el daño a la mitad» añade divisor 2 a R (23.3).
  - `T` = producto de multiplicadores de tipo del defensor (22.2). **Sin STAB, críticos ni variación aleatoria** (23.6).
  - Ignorar Defensa: se elimina la raíz (23.4).
  - Redondeo único al final; `dañoCalculado = clamp(0, VitalidadMáx objetivo)`; `pérdidaReal = min(dañoCalculado, VitalidadActual)` (23.5). Curas y retrocesos «según daño infligido» usan la pérdida real (19.6).
- **Profundidad** (4.2): coste NV N->N+1 = `10 × N × FP`; acumulada para NV N = `5 × FP × N × (N-1)`. Ganancia por combate = `2 × NV del desafío × modificador` (4.3). Módulo opcional de progresión post-combate.
- **Multigolpe** (19.4): cada impacto tira Precisión por separado. La media de 2,5 impactos de «1–5» es **sólo para ordenar PB**, no la distribución real (ver §11).

---

## 6. Pipeline de ronda (implementación literal de CANON-MECHANICS 28)

### 6.1. Despliegue inicial (13.4, 28.1)
1. Cada invocador elige las criaturas iniciales para sus posiciones.
2. Se materializan físicamente **todas**, de una en una, por Velocidad efectiva descendente.
3. Después se reúnen todas las Manifestaciones de Entrada, se ordenan por Velocidad efectiva del portador (salvo Prioridad explícita) y se resuelven **una a una hasta vaciar su cadena**.
4. Campos/Climas incompatibles: el que se resuelve **después** sustituye (una criatura lenta impone su clima; ej. 29).

### 6.2. Inicio de ronda (28.2)
1. Fijar posiciones de la ronda. Un Adepto puede abrir una segunda posición temporal **ahora** (13.2); si varias Materializaciones compiten, por Velocidad; aquí ya **no** se usa la excepción del despliegue inicial.
2. Declaración **simultánea y oculta** de una acción por posición: Técnica, Esquiva, Intercambio, Materialización parcial (si hay posición libre y capacidad), huida/rendición si el contexto lo permite.
3. Declarar objetivos **por posición** (14.2). Multiobjetivo: fijar reparto/secuencia (incluida la condición «concentrar hasta derrotar y seguir con la siguiente»). A todos: conjunto automático al resolver.
4. Congelar declaraciones. No se cambian por información nueva de la ronda.

### 6.3. Intercambios voluntarios (16, 28.3)
- Ordenar por Velocidad efectiva de la **criatura saliente**.
- Para cada uno, en cadena completa: comprobar legalidad (p. ej. Enraizado, Rastro, Mordisco de presa) -> efectos de Retirada -> Salida (borra etapas; conserva estados) -> Materialización del reemplazo -> Manifestaciones de Entrada **como parte de la Materialización** -> respuestas y consecuencias hasta vaciar -> sólo entonces el siguiente Intercambio.
- Si se volvió ilegal: **falla y consume la acción** (14.3, 16.4). Nunca se sustituye por otra acción.
- Excepción de ficha: Caza espectral (Umbrafen) intercepta a la criatura saliente antes del cambio, sin usar Prioridad.

### 6.4. Esquivas (17, 28.4)
- Prioridad absoluta respecto a técnicas ordinarias. Éxito por uso consecutivo: 100% / 50% / 12,5% / 0%.
- Si tiene éxito, evita daño **y efectos** de técnicas enemigas durante la ronda. Cualquier otra acción o abandonar el campo reinicia la racha.

### 6.5. Técnicas y demás acciones (18, 28.5)
- Ordenar por Prioridad (incluidas modificaciones como Oportunista, Anular prioridad, Velocidad invertida) -> Velocidad efectiva -> empate exacto 50% con RNG registrado.
- Para cada acción: comprobar que el usuario sigue activo y la acción es legal -> resolver ocupante actual de la posición objetivo -> Precisión por objetivo/impacto -> ejecutar -> calcular sin redondeos intermedios -> aplicar pérdida -> **resolver primero las respuestas que puedan evitar, modificar o revertir la Derrota** (Último Hilo, Intercesión, Segundo Aliento…) -> recomprobar Vitalidad -> siguiente impacto (Objetivo único se detiene si el objetivo cae; Multiobjetivo sigue la secuencia declarada) -> registrar Derrotas **sin** Reemplazo entre impactos -> efectos secundarios -> **Reemplazos forzados al terminar la técnica** -> sus Entradas -> Intercambios forzados y demás respuestas -> hasta vaciar la cadena.
- Técnicas de carga: turno de carga + turno de ejecución; se pierde si la criatura sale (19.5). Excepciones: condiciones de ficha (Aliento de dragón con Calima) y Materialización parcial.

### 6.6. Cierre (28.6)
1. Efectos de fin de turno de cada criatura (Quemado 6,25%, Regeneración, Fronda Vital…).
2. Efectos de fin de ronda.
3. Decrementar contadores **sólo** de criaturas que estuvieron materializadas en su turno (24.2). Efectos laterales cuentan **rondas**.
4. Mantenimiento de la segunda posición del Adepto; si no se sostiene: Salida, desaparece la posición y los efectos fijados sobre ella pasan a la otra posición del mismo invocador.
5. Condición de fin: todas las criaturas de la Preparación derrotadas -> el invocador pierde la consciencia (26.2). Rendición/huida si aplica.

---

## 7. Motor de cadenas y sistema de efectos

### 7.1. Cadena «hasta sus últimas consecuencias» (10.10)
- Implementar una **pila/cola de eventos** con resolución en profundidad: un efecto se resuelve entero, incluidas las reacciones que provoca, antes del siguiente.
- Simultaneidad (10.9): mismo controlador -> decide su orden (política del invocador); distintos -> Prioridad explícita -> Velocidad del portador -> 50%.
- Límite de profundidad y detección de bucles con `RuleGap`.

### 7.2. DSL de efectos (datos, no código por técnica)
Cada técnica/Manifestación curada tiene `effects: Effect[]`:

```
Effect = {
  trigger:  on_use | on_hit | after_damage | on_entry | on_exit | on_voluntary_withdraw
          | on_switched_out | on_damage_taken | on_hp_threshold | would_be_defeated
          | on_stat_lowered | on_status_applied | on_enemy_voluntary_withdraw
          | end_of_turn | end_of_round | passive | environment,
  condition?: Expr,   // p. ej. target.hasStatus, target.hpPct < 50, user.firstUseOf(tech), weather == "calima"
  target:  self | target | all_enemies | all_allies | all_present | position,
  ops: Op[]           // damage, heal, applyStatus(chance), stage(stat, n, chance), clearStages, cureStatuses,
                      // modifyDamage(pct, filter), divideDamage, modifyStat(pct), modifyAccuracy(pct|pp),
                      // modifyPriority, forceSwitch, selfSwitch, preventWithdraw(turns), setEnvironment,
                      // addSideEffect(rounds), destroySideEffect(kind), mark(name, duration), lockTechnique,
                      // survivesAt1Hp, redirectAttacks, ignoreResistances, ignoreDefense, ...
  duration?: {turns|rounds|untilExit|untilNextAction},
  flags?: {worksWhileDesvinculado, isSecondaryEffect}
}
```

- Los efectos con «efecto secundario» deben marcarse (`isSecondaryEffect`) porque Mundano los usa; **el retroceso no es efecto secundario**.
- Manifestaciones pasivas actúan sólo con la criatura **completamente materializada** (10.7). Desvinculado las desactiva 5 turnos salvo `worksWhileDesvinculado`. Silencio del Vínculo desactiva las de criaturas no Míticas.
- Manifestaciones de Entrada no consumen acción ni pueden retrasarse; la Materialización parcial **no** las activa (ni Entrada ni Retirada).
- «Al salir» responde a cualquier Salida; «al retirarse» sólo a Retirada voluntaria (1. Salida/Retirada).
- «Técnicas de X +N%» afecta a Físicas y Mágicas de ese tipo salvo indicación (CANON-MANIFESTATIONS > Ataque y Ataque mágico).
- «Aliados» incluye al portador y a las demás criaturas aliadas presentes.
- Handlers especiales en código (con test propio) sólo para lo que el DSL no pueda expresar: Canto final, Bajo mi amparo, Caza espectral, Horda, Espejo cóncavo, Equilibrio del Vínculo, Velocidad invertida, Revelación absoluta, Colapso.
- Técnicas/Manifestaciones sin `effects` curados: modo `strict` (se bloquean) o `lenient` (sólo daño/parámetros base + aviso en log). Por defecto `strict`.

---

## 8. Reglas transversales que el motor debe garantizar (invariantes)

1. Máx. 4 criaturas preparadas; máx. 2 Vínculos activos simultáneos (completos o parciales); ningún estamento permite 3.
2. Una criatura no preparada nunca entra en combate.
3. Un Intercambio consume la acción completa; la criatura que entra no actúa esa ronda.
4. Una acción ilegal falla y se consume.
5. Objetivos por posición; el Intercambio no anula ataques declarados (ej. 31).
6. Etapas en [-6, +6]; se borran con cualquier Salida. Los estados persisten.
7. Ninguna estadística numérica < 1.
8. Estados: coexisten salvo inmunidad; misma estadística -> sólo la penalización más severa; restricciones y contadores independientes; inmunidad por cada tipo; Mítico inmune a Espíritu Cercenado y Desvinculado; inmunidad al estado != inmunidad al daño.
9. Contadores en turnos sólo avanzan materializada.
10. Materialización parcial (Invocador+): cualquier técnica preparada de una criatura preparada; ocupa posición y Vínculo; consume acción; **no cambia Prioridad**; salta la fase de carga; sin Manifestaciones; no es Entrada ni Retirada; usa estadísticas reales (1, 11.4, 19.5, 32).
11. Un único Campo/Clima/Anomalía global; los efectos laterales no ocupan ese espacio (25.3).
12. Derrota a 0 Vitalidad: vuelve al Intermedio, no regresa ese combate, pierde etapas, conserva estados (26.1).
13. Reemplazo forzado: no consume acción, no hereda la acción pendiente, activa Entradas (16.6).
14. Las respuestas que impiden la Derrota se resuelven antes de declararla.
15. Declaraciones con información oculta: la IA no puede leer las acciones del rival de esa ronda.

Implementar estos puntos como **tests de propiedades** sobre miles de combates aleatorios.

---

## 9. Registro, trazabilidad y salida narrativa

- `eventLog` estructurado: cada evento con `round, phase, actor, action, targets, rolls, before/after, cause (id del evento padre), ruleRef`.
- Vista de **reconstrucción causal** (37.1): por ronda, para cada participante: intención (declaración) -> compromiso -> interferencia -> efecto decisivo (orden por Prioridad/Velocidad) -> consecuencia física -> información obtenida.
- Exportador narrativo: produce una línea temporal continua lista para prosa, **sin** vocabulario de «ronda/turno/acción/Prioridad» (37). Debe poder responder: qué podía hacer cada uno, qué declaró, qué ocurrió primero, por qué un Intercambio funcionó o falló, qué Manifestación se activó, qué persistió, cuánto daño era posible y qué era imposible.
- Repetición exacta de un combate a partir de `seed + estado inicial + declaraciones`.

---

## 10. IA de declaración (`ai/`)

- Interfaz `Policy.declare(visibleState, legalActions, rng) -> Declarations`.
- Implementaciones: aleatoria legal, voraz (máximo daño esperado), heurística táctica (Intercambios defensivos, estados, climas), y opcional búsqueda (MCTS con información imperfecta).
- Políticas humanas: CLI/UI que muestra acciones legales con su motivo si son ilegales.
- Modo lote: N combates con semillas distintas -> estadísticas de victoria, duración, daño medio, uso de técnicas.

---

## 11. Lagunas detectadas (hacer configurables, no inventar)

| Laguna | Opción por defecto sugerida (marcar como supuesto) |
|---|---|
| Faltan fichas de especie (CANON-CREATURES) | Criaturas individuales con estadísticas explícitas |
| Distribución de impactos en «1–5» | Uniforme 1–5 (configurable) |
| Cómo se decide si un Adepto sostiene la segunda posición | Parámetro por invocador (rondas máximas o probabilidad) |
| Espíritu Cercenado: «beneficios de la combinación dual a la mitad» | Sin efecto hasta definir qué beneficios son |
| Materialización parcial contra una posición declarada vacía | Los ataques declarados a esa posición fallan si está vacía al resolverse |
| «Técnica de contacto» (Caparazón incandescente, Hoja trampa) no está etiquetada | Campo curado `contact: boolean` en overrides |
| Técnicas con coste no múltiplo estándar o precisión «Según técnica» (Horda) | Handler especial |
| Duración exacta de efectos «hasta finalizar la siguiente ronda» | Expira al cierre de la ronda siguiente a su creación |

Cada supuesto activo se lista en la cabecera del log del combate.

---

## 12. Pruebas obligatorias (casos canónicos del propio corpus)

- 33: estadística 240 a NV100 -> 320; con +25% Fortaleza -> 400.
- 20.2: Precisión 100% con Desorientado -> 75%; + Tercer ojo -> 85%.
- 21.3: +25% y -50% directos -> ×0,75.
- 23.5: daño bruto 1400 contra 1000 máx./1000 actual -> 1000; con 170 actual -> pérdida 170.
- 24.1: Paralizado + Enraizado -> Velocidad -50% (no -75%); ambos contadores independientes.
- 29: despliegue con dos climas -> prevalece el de la criatura lenta.
- 30: dos Intercambios; Entrada rápida aplica Enraizado -> el Intercambio rival falla y se consume.
- 31: técnica dirigida a la posición de Risco impacta al nuevo ocupante.
- 32: Materialización parcial de Nimbaro: sin Manifestaciones, misma Prioridad, colas vuelven al Intermedio.
- 17: secuencia de Esquivas 100/50/12,5/0 y reinicio.
- 19.4: multigolpe Objetivo único se detiene al derrotar; Multiobjetivo continúa a la posición declarada; Reemplazo sólo al final.
- Validador: Preparación con 5 criaturas, técnica de coste 150, Manifestación duplicada, Manifestación de elemento incompatible, Amplitud excedida.
- Preparaciones de CANON-NOVELS (p. ej. la final de Adriano en IV) como escenarios de integración.

---

## 13. Fases de entrega

1. Cargador + validación de `Data/` + informe de cobertura.
2. `rules/` puras con tests de fórmulas.
3. Modelo + validador de Preparación.
4. Pipeline de ronda sin efectos especiales (daño, tipos, precisión, estados, etapas, Intercambios, Esquiva, Reemplazos).
5. Motor de cadenas + DSL de efectos + curado progresivo (primero Manifestaciones de Entrada, estados, climas; luego el resto).
6. Log causal, repetición y exportador narrativo.
7. IA y modo lote.
8. UI.

Tras cada fase: tests en verde, informe de cobertura actualizado y lista de `RuleGap` encontradas.

---

## 14. Restricciones de trabajo

- No inventar reglas, cifras ni efectos. Toda decisión no respaldada va a la tabla de lagunas.
- No alterar los JSON generados a mano; usar overrides.
- Código sin comentarios largos; una línea con la referencia de sección cuando aporte.
- Priorizar corrección y auditabilidad sobre rendimiento.
