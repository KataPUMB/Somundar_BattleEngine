# Simulador de combates de Somundar

Ýrbitro determinista, reproducible y auditable de duelos de invocación. Aplica literalmente las normas de `NarrativeEngine/05_SISTEMA_DE_INVOCACION.md` (CANON-MECHANICS, CANON-TECHNIQUES y CANON-MANIFESTATIONS, revisión r2) y usa como base de datos los JSON de `Data/`.

No es un videojuego libre: nunca inventa reglas. Cuando el canon no cubre una situación, el motor aplica un **supuesto configurable** (`RuleGap`), lo declara en la cabecera del log y lo marca en el evento donde interviene.

La especificación completa está en [PROMPT_ARQUITECTURA.md](PROMPT_ARQUITECTURA.md).

---

## Estado

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Cargador + validación de `Data/` + informe de cobertura | Hecha |
| 2 | Fórmulas puras (`rules/`) con tests | Hecha |
| 3 | Modelo + validador de Preparación | Hecha |
| 4 | Pipeline de ronda sin efectos especiales | Hecha |
| 5 | Motor de cadenas + intérprete del DSL de efectos + curado | En curso (ver abajo) |
| 6 | Log causal, exportador narrativo | Parcial (log estructurado y repetición exacta) |
| 7 | IA y modo lote | Parcial (política aleatoria legal y modo interactivo por consola) |
| 8 | UI | Pendiente |

Lo que ya funciona: despliegue inicial, posiciones (incluida la temporal del Adepto), declaración oculta, Intercambios, Esquivas, técnicas ordenadas por Prioridad/Velocidad, daño, tipos, precisión, multigolpe (Objetivo único / Multiobjetivo / A todos), técnicas de carga, Materialización parcial, Derrota y Reemplazo forzado, Quemado, contadores de estados, restricciones de Enraizado y Desorientado, fin de combate.

Lo que todavía **no** tiene efecto: las técnicas y Manifestaciones sin curar. En strict las técnicas sin curar no se pueden declarar; las Manifestaciones sin curar se registran en el log como `manifestation_inert` con el motivo.

Fase 5 hasta ahora: intérprete del DSL con condiciones estructuradas; Manifestaciones activas solo con la criatura completamente materializada (10.7), desactivadas por Desvinculado (24.10) o por Silencio del Vínculo; modificadores de daño de Manifestaciones y Climas sumados en M (23.2); precisión «nunca falla» por Clima; Entradas que aplican estados a todos los enemigos; Campos/Climas/Anomalías que se sustituyen (25.1); bonificaciones «la siguiente técnica tras entrar»; Puño preciso (solo en el primer turno tras materializarse; hace retroceder al objetivo que aún no ha actuado). Siguen sin efecto: etapas, curas, retrocesos, Intercambios forzados, efectos laterales y el resto de técnicas y Manifestaciones sin curar.

---

## Requisitos e instalación

- Node.js 22 o superior.
- Python 3 solo si se quiere regenerar `Data/` con `tools/build_data.py`.

```bash
npm install
npm run build        # compila src/ -> dist/
npm test             # compila y ejecuta todos los tests
```

---

## Uso de la CLI

Todos los comandos se ejecutan desde la raíz del proyecto sobre el código compilado (`dist/`). Si has cambiado código, ejecuta antes `npm run build`.

```bash
node dist/app/cli.js validate-data                 # valida Data/ (errores y avisos)
node dist/app/cli.js coverage                      # informe de cobertura en modo strict
node dist/app/cli.js coverage --mode lenient       # ... en modo lenient
node dist/app/cli.js coverage --json               # informe completo por técnica/Manifestación
node dist/app/cli.js gaps                          # lista de lagunas y supuestos activos
node dist/app/cli.js validate <setup.json>         # valida la Preparación de un bando
node dist/app/cli.js simulate <escenario.json>     # simula un combate
```

Opciones de `simulate`:

| Opción | Efecto |
|---|---|
| `--human 0`, `--human 1`, `--human both` | Ese bando lo decides tú por consola; el resto usa la política aleatoria |
| `--pretty` | Log en texto legible (se activa solo con `--human`) |
| `--json` | Vuelca el log estructurado completo en JSON |
| `--seed N` | Semilla del RNG del combate (por defecto, la del escenario) |
| `--mode strict\|lenient` | Sobrescribe el modo de efectos del escenario |
| `--data DIR` | Carpeta de datos alternativa (por defecto `Data`) |

También existe `npm run simulate -- <escenario.json> [opciones]`, que recompila antes.

### ¿Quién decide las acciones?

Sin `--human`, **ambos bandos usan la política aleatoria legal**: en cada posición eligen al azar una acción permitida y un objetivo enemigo. Sirve para probar el motor y para los tests de propiedades, no para jugar. Las IAs tácticas (voraz, heurística, búsqueda) son la fase 7.

Con `--human`, en cada ronda la consola muestra:

1. **Tablero**: posiciones propias y rivales con Vitalidad, estados (con sus contadores de turnos) y etapas. De tu Intermedio ves todo; del rival, solo cuántas reservas viables le quedan.
2. **Establecimiento de posiciones**: si hay una posición libre o eres Adepto, puedes materializar una criatura completa.
3. **Acciones legales numeradas**, con clase, tipo, PB, impactos, Prioridad y alcance. Las ilegales aparecen sin número, con el motivo y la sección del canon (por ejemplo, un Intercambio bloqueado por Enraizado).
4. **Objetivos**: Objetivo único -> una posición; Multiobjetivo -> secuencia de posiciones («concentrar hasta derrotar y seguir con la siguiente»); A todos -> automático.
5. **Reemplazos forzados**: se te pregunta qué criatura entra.
6. Al resolver, el log de la ronda en texto legible.

Limitación: con `--human both` los dos jugadores comparten terminal, así que el segundo ve la declaración del primero. La declaración realmente oculta llegará con la UI (fase 8).

---

## Escenarios

Un escenario es un JSON con los dos bandos. Ver el ejemplo [scenarios/ejemplo_ficticio.json](scenarios/ejemplo_ficticio.json) (estadísticas inventadas, no canon).

```jsonc
{
  "seed": 11,
  "config": { "effectsMode": "strict", "maxRounds": 30 },
  "sides": [
    {
      "summoner": {
        "id": "s0", "name": "Invocador A", "estamento": "invocador",
        "amplitude": 250,                 // null = sin restricción global (Arconte, 8.6)
        "fortalezaCapacity": 40, "fortalezaMaxPerStat": 20,
        "simultaneity": "stable",         // single | adept_temporary | stable
        "partialMaterialization": true,
        "manifestationRepertoire": ["calima"],
        "adeptSustain": { "maxRounds": 2, "chancePct": 80 }   // opcional, solo Adepto
      },
      "preparation": {
        "creatures": [
          {
            "id": "brasal_a", "speciesId": "brasal", "types": ["fuego"], "nv": 40,
            "baseStatsNV50": { "hp": 260, "atk": 120, "matk": 80, "def": 90, "mdef": 80, "spe": 110 },
            "fortaleza": { "atk": 20, "spe": 10 }, "orientations": ["atk", "spe"],
            "equippedTechniques": ["golpe_candente", "aranazo"],
            "equippedManifestations": ["calima"],
            "persistentStatuses": [{ "id": "enraizado", "counters": { "no_voluntary_withdraw": 1 } }],
            "hpCurrent": 200,             // opcional; por defecto Vitalidad máxima
            "priorForms": [],             // formas anteriores (técnicas especiales heredadas)
            "transfigurationLine": null   // para comprobar 2.5
          }
        ]
      },
      "initialDeployment": ["brasal_a", null]   // null deja la posición vacía
    }
  ]
}
```

Las estadísticas de las criaturas son **explícitas por instancia** porque falta CANON-CREATURES (`04_CRIATURAS.md`): `creatures.json` solo tiene nombre, número y técnicas especiales de las 160 especies.

Los presets por estamento (Amplitud, Fortaleza, simultaneidad, Materialización parcial) están en [src/engine/model/presets.ts](src/engine/model/presets.ts). Son referencias, no llaves: el invocador lleva siempre sus capacidades como campos explícitos.

---

## Datos y curado de efectos

`Data/*.json` lo genera `tools/build_data.py` a partir del canon y **no se edita a mano**.

- En técnicas, `description` es autoritativo; en Manifestaciones, `text`. El campo `mechanics` es una extracción asistida, solo orientativa.
- Los efectos curados se añaden en `Data/effects/*.json` sin tocar los JSON generados:

```json
{
  "techniques": {
    "golpe_candente": { "effects": [] },
    "mordisco": { "effects": [], "charge": true, "contact": true },
    "tormenta": { "effects": [ { "trigger": "on_hit", "target": "target", "ops": [ { "op": "applyStatus", "status": "paralizado", "chance": 30 } ] } ] }
  },
  "manifestations": {
    "calima": { "effects": [ ... ], "worksWhileDesvinculado": false }
  }
}
```

- `effects: []` significa **verificado: sin efecto más allá de sus parámetros base**. [Data/effects/base_only.json](Data/effects/base_only.json) marca así 35 técnicas (las que dicen «Sin efecto adicional» y las anatómicas cuya descripción solo describe el gesto). Este curado es revisable.
- El formato de `effects` (disparadores, objetivos, operaciones) está en [src/engine/effects/dsl.ts](src/engine/effects/dsl.ts). El cargador valida su estructura (disparadores, objetivos, operaciones y claves de condición).
- Curado actual: [Data/effects/base_only.json](Data/effects/base_only.json) (técnicas sin efecto adicional), [Data/effects/techniques_core.json](Data/effects/techniques_core.json) (Puño preciso) y [Data/effects/manifestations_core.json](Data/effects/manifestations_core.json) (52 Manifestaciones: daño por tipo o clase, condicionales, «siguiente técnica tras entrar», estados al entrar, Calima, Llovizna, Campo floral y Silencio del Vínculo).
- Si el texto de una Manifestación incluye algo que el intérprete aún no sabe hacer, se cura entera con una operación sin intérprete (p. ej. `modifyHealing` en Velo nocturno) para que quede bloqueada y no se aplique a medias.

### Efectos: disparadores, condiciones y operaciones

```json
{ "trigger": "passive", "target": "self",
  "condition": { "techniqueType": ["fuego"], "targetHasAnyStatus": true },
  "ops": [ { "op": "modifyDamage", "role": "dealt", "pct": 50 } ] }
```

| Pieza | Valores implementados |
|---|---|
| `trigger` | `passive` (mientras está materializada), `on_entry`, `on_voluntary_withdraw`, `on_exit`, `on_use`, `on_hit`, `environment` (mientras el Clima/Campo/Anomalía está activo) |
| `target` | `self`, `target`, `all_enemies`, `all_allies`, `all_present` |
| `condition` | `techniqueType`, `techniqueClass`, `subjectTypes`, `subjectNotTypes`, `targetHasAnyStatus`, `targetHpBelowPct`, `targetHasNotActed`, `userFirstTurnSinceEntry` |
| `ops` con intérprete | `modifyDamage` (`role` dealt/taken, `pct`, `oncePerEntry`), `modifyAccuracy` (`pct`, `pp`, `neverMiss`), `applyStatus` (`status`, `chance`), `setEnvironment`, `disableManifestations`, `flinch`, `failTechnique` |
| `flags` | `isSecondaryEffect`, `perHit` (efecto por impacto en vez de una vez por objetivo), `worksWhileDesvinculado` |

El resto de operaciones listadas en [src/engine/effects/dsl.ts](src/engine/effects/dsl.ts) se validan pero aún no se ejecutan: lo que las usa queda bloqueado.

### Modos `strict` y `lenient`

| Situación | strict (por defecto) | lenient |
|---|---|---|
| Técnica con `effects: []` | Se ejecuta | Se ejecuta |
| Técnica sin curar | **Bloqueada** (no se puede declarar) | Solo daño/parámetros base + aviso en el log |
| Técnica curada con operaciones aún no implementadas | Bloqueada | Bloqueada |
| Poder o precisión no numéricos (Horda, Eco exacto, Silencio de alas) | Bloqueada hasta tener handler | Bloqueada |

Cobertura actual: en strict se pueden usar 36 de 343 técnicas; en lenient, 340. Están activas 52 de las 138 Manifestaciones; 85 siguen sin curar y 1 está curada pero bloqueada (Velo nocturno, por la curación).

---

## Arquitectura

```
src/
  data/            cargador, validación de esquemas y overrides, informe de cobertura
  engine/
    model/         tipos del dominio (Summoner, BondedCreature, BattleState...) y presets
    rules/         fórmulas puras: estadísticas, etapas, precisión, daño, tipos, Profundidad
    pipeline/      despliegue, orden de ronda (28.1-28.6), Intercambios, técnicas, Reemplazos
    legality/      validador de Preparación y acciones legales con motivo
    effects/       DSL de efectos y disponibilidad strict/lenient
    ai/            políticas de declaración (aleatoria legal)
    log/           eventos estructurados
    gaps.ts        registro de lagunas (RuleGap) y supuestos por defecto
    rng.ts         RNG con semilla y estado serializable
  app/             CLI, bucle de simulación, modo interactivo y formateador del log
  tests/           tests unitarios, de escenarios canónicos y de propiedades
```

Principios:

- **Motor puro.** Cada paso recibe un estado y devuelve uno nuevo (copia estructural); el estado de entrada no se modifica. No hay E/S, reloj ni aleatoriedad global.
- **RNG con semilla** guardado en el propio estado. Cada tirada queda registrada (`purpose`, `roll`, `threshold`, `result`). Las probabilidades de 0% y 100% no consumen tirada.
- **Repetición exacta**: misma semilla + mismo estado inicial + mismas declaraciones -> mismo log.
- Cada regla implementada lleva una línea con su sección del canon (`// CANON-MECHANICS 23.5`).

### API del motor

```ts
import { loadGameData } from './data/loader.js';
import { createBattle, beginRound, resolveRound } from './engine/pipeline/battle.js';
import { legalActions } from './engine/legality/actions.js';

const { data, issues } = loadGameData('Data');
let st = createBattle(data, [setupA, setupB], { seed: 1, config: { effectsMode: 'strict' } }); // valida y despliega (28.1)
st = beginRound(data, st, [/* materializaciones al inicio de ronda */]);                        // 28.2.1-2
st = resolveRound(data, st, { S0P0: accionA, S1P0: accionB }, controllers);                     // 28.3-28.6
```

- Las posiciones se identifican como `S<bando>P<ranura>` (`S0P0`, `S1P1`...).
- Acciones: `technique`, `dodge`, `switch`, `partial` (Materialización parcial en posición vacía) y `surrender`.
- Objetivos: `position`, `sequence` (concentrar y seguir), `perHit` (reparto explícito) y `auto` (A todos).
- Una declaración ilegal lanza `DeclarationError`; una Preparación inválida, `PreparationError` con todos los errores.
- `controllers.chooseReplacement` decide los Reemplazos forzados; por defecto, la primera reserva viable.

### Log

Cada evento lleva `id, round, phase, type, actor, targets, data, rolls, cause (id del evento padre), ruleRef`. El primer evento (`battle_start`) incluye la semilla, la configuración y la lista de supuestos activos. Tipos principales: `materialize`, `switch`, `exit`, `dodge_success/fail`, `action_order`, `technique`, `damage`, `miss`, `dodged`, `defeat`, `forced_replacement`, `action_failed`, `status_damage`, `rule_gap`, `battle_end`.

---

## Lagunas del canon (RuleGap)

`node dist/app/cli.js gaps` lista las 27 lagunas con su pregunta y el supuesto aplicado. Las que más afectan al juego:

| Laguna | Supuesto actual |
|---|---|
| Faltan fichas de especie (CANON-CREATURES) | Estadísticas y tipos explícitos por instancia; no se valida el aprendizaje de técnicas no especiales |
| Distribución de impactos en «1-5» | Uniforme |
| Mantenimiento de la segunda posición del Adepto | `adeptSustain` por invocador; si falta, 1 ronda |
| Cuándo ha tenido turno una criatura (contadores, Quemado) | Si ocupaba posición al declarar y sigue materializada al cierre |
| Orden de técnicas si cambia la Velocidad a mitad de ronda | Orden fijado al empezar la fase de técnicas |
| Acciones mientras se carga | Solo ejecutar la carga o Intercambiar |
| Materializar una criatura completa en una posición vacía | Permitido al inicio de ronda, ordenado por Velocidad |
| Vitalidad al empezar un combate | Máxima, salvo `hpCurrent` explícito (los estados sí persisten) |
| Reaplicar un estado que ya tiene | Sin efecto |
| Ambos bandos derrotados en la misma ronda | Empate |
| Técnica contra posición vacía | El impacto falla |
| «A todos» sin curar | Todas las posiciones enemigas ocupadas |
| Puño preciso usado mediante Materialización parcial | Cuenta como primer turno tras materializarse: funciona |
| Hacer retroceder (Puño preciso) | Es efecto secundario; la acción pendiente del objetivo falla y se consume; una carga en curso se conserva; si ya actuó (incluida Esquiva) no hace nada |
| Activación y duración de Campos/Climas/Anomalías | Se activan con la Entrada de su portador y duran hasta ser sustituidos, aunque el portador salga |
| Efectos al impactar en multigolpe | Una vez por objetivo impactado salvo `perHit`; nunca sobre criaturas ya derrotadas |

---

## Tests

`npm test` ejecuta 62 tests:

- **Datos**: esquemas, referencias cruzadas técnica <-> especie, overrides y cobertura.
- **Fórmulas**: casos canónicos 33 (240 -> 320 -> 400), 20.2 (75% -> 85%), 21.3 (x0,75), 23.5 (1000 / 170), 24.1 (Paralizado + Enraizado = -50%), tabla de etapas 21.2, tipos duales, inmunidades, Profundidad y Esquiva.
- **Validador**: 5 criaturas, 50+50+50 = 150 de coste local, Amplitud excedida, Manifestación duplicada o incompatible, huecos por NV, Fortaleza, técnica especial ajena, línea de Transfiguración y despliegue; devuelve todos los errores a la vez.
- **Pipeline**: despliegue por Velocidad (29, parcial), orden de Intercambios, objetivo por posición (31), Materialización parcial (32), Esquivas 100/50/12,5/0 (17), multigolpe y Reemplazo al final (19.4), carga, Quemado y contadores, Adepto, modo strict, fin de combate, inmutabilidad del estado.
- **Propiedades**: 300 combates aleatorios comprobando los invariantes de la sección 8 de la especificación, más repetición exacta por semilla.

- **Efectos (fase 5)**: despliegue con dos Climas en el que prevalece el de la criatura lenta (29), Entrada rápida que aplica Enraizado y hace fallar el Intercambio rival (30), suma de modificadores en M (Combustión + Juramento = x0,75; Devorallamas = 0), Calima, Llovizna con Rayo que nunca falla bajo Desorientado, Desvinculado y Silencio del Vínculo desactivando Manifestaciones, Ignición una vez por Entrada, Punto de ignición, inmunidad Mítica a Desvinculado, y Puño preciso (retroceso del objetivo, fallo fuera del primer turno, recarga al volver a entrar y uso mediante Materialización parcial).

Pendiente en la fase 5: etapas (con las restricciones «no puede aumentar» de los estados), curas, retrocesos y drenajes, Intercambios forzados, efectos laterales, respuestas de supervivencia y el curado del resto de técnicas y Manifestaciones.
