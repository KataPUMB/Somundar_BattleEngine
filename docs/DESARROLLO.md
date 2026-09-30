# Notas de desarrollo del simulador

Referencia interna (estado, arquitectura, DSL de efectos, curado, supuestos y tests). El README solo contiene uso e instalación.

Árbitro determinista, reproducible y auditable de duelos de invocación. Aplica literalmente las normas de `NarrativeEngine/05_SISTEMA_DE_INVOCACION.md` (CANON-MECHANICS, CANON-TECHNIQUES y CANON-MANIFESTATIONS, revisión r2) y usa como base de datos los JSON de `Data/`.

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
| 5 | Motor de cadenas + intérprete del DSL de efectos + curado | Hecha: 343/343 técnicas y 138/138 Manifestaciones |
| 6 | Log causal, exportador narrativo | Parcial (log estructurado y repetición exacta) |
| 7 | IA y modo lote | Parcial (política aleatoria legal y modo interactivo por consola) |
| 8 | UI | Pendiente |

Lo que ya funciona: despliegue inicial, posiciones (incluida la temporal del Adepto), declaración oculta, Intercambios, Esquivas, técnicas ordenadas por Prioridad/Velocidad, daño, tipos, precisión, multigolpe (Objetivo único / Multiobjetivo / A todos), técnicas de carga, Materialización parcial, Derrota y Reemplazo forzado, Quemado, contadores de estados, restricciones de Enraizado y Desorientado, fin de combate.

Lo que todavía **no** tiene efecto: nada del catálogo. Horda funciona cuando la instancia de Holómicor declara sus tres cadáveres (`horde`, ver Escenarios); sin ellos es ilegal (GAP-HORDA).

Fase 5: las 343 descripciones de técnicas se han revisado una a una y están curadas en `Data/effects/`. El motor ejecuta etapas (con los límites [-6,+6] y las restricciones «no puede aumentar» de Paralizado, Saturado y Agrietado), curaciones (con Desvinculado, reducciones de curación y Velo nocturno), retroceso y drenaje sobre la Vitalidad realmente perdida, pérdidas de Vitalidad propias, estados con probabilidad por objetivo o por impacto, efectos laterales de lado (Barrera de fuerza y Zona antimagia dividen el daño; Estela; bóvedas y mantos que reducen el daño) y su destrucción, marcas temporales sobre criaturas (guardias «el siguiente daño», evasión, bajadas de Precisión del próximo ataque, Rastro, Acecho, Infección, Canto final, castigo por contacto, reacciones), sustituciones del usuario (forzadas u opcionales), Prioridad modificada durante la ronda (Anular prioridad, Arrastre de corriente, Pulso intermitente), Velocidad invertida, Revelación absoluta, redirección (Bajo mi amparo), intercepción de Intercambios (Caza espectral), daño repartido a la segunda criatura (Bola de fuego, Arco serpentino), cambios de estadística ofensiva (Defensa, Velocidad o el ataque del objetivo), ignorar Defensa o barreras, supereficacia forzada, técnicas de carga, técnicas que no pueden repetirse y opciones declaradas (Mueca).

Las 138 Manifestaciones también están curadas. Además de los modificadores de daño por tipo o clase, el motor aplica:

- **Auras**: una Manifestación pasiva alcanza al portador (`self`), a sus aliados (`all_allies`, `other_allies`), a los enemigos (`all_enemies`) o a todos los presentes (`all_present`) mientras el portador está completamente materializado: Guardamar, Baluarte, Fronda guardiana, Pulso nervioso, Formación de caza, Ionización, Estrato desigual, Negación elemental, Equilibrio del Vínculo...
- **Modificadores de estadística** (`modifyStat`), también condicionados a un estado (Corazón de brasa, Raíz férrea, Voluntad desnuda aunque esté Desvinculado) o al equipo (Arsenal ligero, Poder latente con `canTransfigure`).
- **Curación dada y recibida**: Manantial interior, Savia medicinal, Corazón del bosque, Manos de luz y Triaje multiplican las curaciones que hace el portador; Voluntad radiante, las que recibe.
- **Por turno**: Regeneración, Fronda vital, Hambre del abismo y los Climas/Campos con pérdida o recuperación periódica (Tormenta eléctrica, Campo luminoso) actúan al final del turno de cada criatura.
- **Al entrar con un Clima/Campo activo**: Campo rocoso y Vendaval quitan el 12,5% a quien no es de su tipo, antes de sus propias Manifestaciones de Entrada.
- **Respuestas**: Último hilo e Intercesión (sobrevivir con 1 a un golpe letal con la Vitalidad completa), Segundo aliento (una vez por combate al bajar del 50%), Desafiante, Contramedida y No me toques (al bajar una característica), Respuesta adaptativa (al recibir una técnica), Hambre de sombras (retirada enemiga), Relevo (al ser sustituido).
- **Compromiso**: Amartillar, Concentración y Ataque rápido solo permiten repetir la primera técnica usada desde la Entrada.
- **Otros**: Sobrecarga (mínimo 4 impactos), Mundano, Versatilidad, Último recurso, Afinidad prestada, Ruptura de afinidad, Invariante, Concentración absoluta, Oportunista, Espejo cóncavo, Raíz compartida, Retaguardia, Fortificación, Presagio imposible, Presencia opresiva y Presión arcana.

**Resolución hasta las últimas consecuencias (10.10, 16.3, 16.5, 16.6, 28.1, 28.5).** Cada acción abre una cadena que se vacía por completo, en profundidad, antes de pasar a la siguiente acción:

- **Reemplazos por Derrota:** la Derrota se registra al instante, pero el Reemplazo forzado es lo último de la ronda. Se hace al terminar todas las acciones (o al final del cierre si la Derrota ocurre en él), y la Entrada del reemplazo resuelve toda su cadena en ese momento (GAP-REPLACEMENT-TIMING).
- **Posición vacía:** si la posición declarada está vacía al resolverse (por ejemplo, su ocupante ha sido derrotado y todavía no ha sido reemplazado), el ataque va contra la otra posición ocupada de ese lado; si no hay ninguna, el impacto se pierde (GAP-EMPTY-TARGET).
- Dentro de una técnica, los Intercambios forzados esperan a que la técnica termine (28.5); las respuestas que no mueven criaturas (Desafiante, Segundo aliento, Último hilo...) se resuelven al instante.
- Fuera de una técnica, cada eslabón (un Reemplazo, un Intercambio forzado, cada Manifestación de Entrada, el efecto ambiental de Entrada) se resuelve con todas sus consecuencias antes que las consecuencias que ya estaban pendientes. En el despliegue inicial, cada Manifestación de Entrada se resuelve entera antes de la siguiente (28.1.7).
- Ejemplo: Rebufo -> sustitución -> entra una criatura con Presencia opresiva y Presión arcana -> Presencia baja el Ataque del rival -> su No me toques lo sustituye -> el reemplazo entra y su Marca ardiente quema a quien acaba de entrar -> **solo entonces** se resuelve Presión arcana, que ya alcanza al rival nuevo -> la acción pendiente de la criatura retirada se pierde.
- Cualquier criatura que llegue a 0 fuera de un impacto (Climas, Hambre del abismo, marcas...) se derrota dentro de la misma cadena (y se reemplaza al final de la ronda). Un usuario derrotado a mitad de técnica (reflejo) no realiza más impactos.
- Los bucles de Intercambios forzados (dos No me toques que se provocan mutuamente) se cortan al superar `maxChainDepth` (GAP-CHAIN-DEPTH).

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
  "config": { "effectsMode": "strict", "maxRounds": 30, "damageConstant": 0.9375 },   // damageConstant opcional (canon 23.1: 0.9375; 0.75 = fórmula anterior)
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
            "nickname": "Chispa",         // opcional; sustituye al nombre de la especie en el log y la consola
            "baseStatsNV50": { "hp": 260, "atk": 120, "matk": 80, "def": 90, "mdef": 80, "spe": 110 },
            "fortaleza": { "atk": 20, "spe": 10 }, "orientations": ["atk", "spe"],
            "equippedTechniques": ["golpe_candente", "aranazo"],
            "equippedManifestations": ["calima"],
            "persistentStatuses": [{ "id": "enraizado", "counters": { "no_voluntary_withdraw": 1 } }],
            "hpCurrent": 200,             // opcional; por defecto Vitalidad máxima
            "priorForms": [],             // formas anteriores (técnicas especiales heredadas)
            "transfigurationLine": null,  // para comprobar 2.5
            "canTransfigure": false,      // Poder latente (falta CANON-CREATURES)
            "horde": [                    // solo Holómicor con Horda: tres cadáveres
              { "speciesId": "lobo", "atkNV50": 150, "techniqueId": "aranazo" }
            ]
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
- Curado actual: [base_only.json](Data/effects/base_only.json) y las técnicas sin efecto de [techniques_elemental.json](Data/effects/techniques_elemental.json) / [techniques_special.json](Data/effects/techniques_special.json) (80 técnicas verificadas sin efecto adicional), [techniques_core.json](Data/effects/techniques_core.json) (Puño preciso), [techniques_elemental.json](Data/effects/techniques_elemental.json) (anatómicas, elementales y sin elemento), [techniques_special.json](Data/effects/techniques_special.json) (las 160 especiales) y [manifestations_core.json](Data/effects/manifestations_core.json) (53 Manifestaciones: daño por tipo o clase, condicionales, «siguiente técnica tras entrar», estados al entrar, Calima, Llovizna, Campo floral y Silencio del Vínculo) y [manifestations_rest.json](Data/effects/manifestations_rest.json) (las 85 restantes: auras, curación, respuestas, compromisos, Climas y Campos con efectos por turno o al entrar).
- Cada entrada es una transcripción literal de la descripción; cuando el texto no basta, la entrada remite a su RuleGap (`ruleRef`).
- Si el texto de una Manifestación incluye algo que el intérprete aún no sabe hacer, se cura entera con una operación sin intérprete para que quede bloqueada y no se aplique a medias.

### Efectos: disparadores, condiciones y operaciones

```json
{ "trigger": "passive", "target": "self",
  "condition": { "techniqueType": ["fuego"], "targetHasAnyStatus": true },
  "ops": [ { "op": "modifyDamage", "role": "dealt", "pct": 50 } ] }
```

| Pieza | Valores implementados |
|---|---|
| `trigger` | `passive` (siempre activo: Manifestaciones materializadas o durante la propia técnica), `on_entry`, `on_voluntary_withdraw`, `on_exit`, `on_use` (antes de los impactos), `on_hit` (tras los impactos, una vez por objetivo o `perHit`), `after_damage` (si causó pérdida de Vitalidad), `after_use` (siempre al terminar), `environment` (mientras el Clima/Campo/Anomalía está activo), `environment_entry` (Clima/Campo activo cuando alguien entra), `end_of_turn`, `on_switched_out`, `on_enemy_voluntary_withdraw`, `on_stat_lowered`, `on_hp_threshold`, `would_be_defeated`, `on_technique_received` |
| `target` | `self`, `target`, `all_enemies`, `all_allies`, `other_allies`, `all_present`, `lowest_ally`; `targetFilter` filtra cada objetivo con las mismas claves de condición |
| `condition` | tipo/clase de técnica, tipos del sujeto, estados o marcas del objetivo, etapas del objetivo, Vitalidad del usuario u objetivo, si el objetivo ya actuó, falló su última técnica o declaró una técnica de Estado, si el usuario recibió daño o causó daño la ronda anterior, primer turno tras entrar, Clima activo, opción declarada, impactos sobre el objetivo, fase de la técnica, estados del sujeto, carga en curso, categoría de la técnica o tipo no propio, técnica con efectos adicionales, primer uso, coste del equipo, umbral de Vitalidad cruzado, Vitalidad completa |
| `ops` | daño y precisión: `modifyDamage`, `modifyAccuracy`, `ignoreDefense`, `attackStat`, `typeOverride`, `ignoreBarriers`, `modifyPriority`; estado y etapas: `applyStatus`, `cureStatuses`, `stage`, `clearStages`, `stealStage`, `stageHighest`, `convertStages`; Vitalidad: `heal`, `drain`, `recoil`, `selfDamage`, `distributeHeal`, `modifyHealing`; campo: `setEnvironment`, `clearEnvironment`, `disableManifestations`, `addSideEffect`, `destroySideEffect`, `setFieldFlag`; criatura: `mark`, `removeMarks`, `consumeMark`, `lockTechnique`, `selfSwitch`, `flinch`, `failTechnique`, `modifyStat`; Manifestaciones: `divideDamage`, `survivesAt1Hp`, `commitFirstTechnique`, `minHits`, `invertStages`, `capManifestationDamage`, `ignoreEnvironmentDamage`, `shareDamage`, `extendBarriers`, `typedLoss` |
| `flags` | `isSecondaryEffect`, `perHit`, `worksWhileDesvinculado`, `oncePerBattle` |

Campos de técnica en el override: `targetSide` (`self`, `ally`, `side`), `targetSet`, `declareAs`, `charge`, `chargeSkipEnvironment`, `noConsecutiveUse`, `usableIf`, `choices`, `splashPct`, `streak`, `phases`, `interceptSwitch`, `accuracyAssumed`, `neverMiss`, `contact`, `requiresInstinct`, `handler`. El cargador valida disparadores, objetivos, operaciones, estados, estadísticas, tipos de marca y claves de condición.

### Modos `strict` y `lenient`

| Situación | strict (por defecto) | lenient |
|---|---|---|
| Técnica con `effects: []` | Se ejecuta | Se ejecuta |
| Técnica sin curar | **Bloqueada** (no se puede declarar) | Solo daño/parámetros base + aviso en el log |
| Técnica curada con operaciones aún no implementadas | Bloqueada | Bloqueada |
| Horda sin cadáveres declarados en la instancia | Ilegal | Ilegal |

Cobertura actual: en strict se pueden usar las 343 técnicas y están activas las 138 Manifestaciones.

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

`node dist/app/cli.js gaps` lista las 73 lagunas con su pregunta y el supuesto aplicado. Las que más afectan al juego:

| Laguna | Supuesto actual |
|---|---|
| Faltan fichas de especie (CANON-CREATURES) | Estadísticas y tipos explícitos por instancia; no se valida el aprendizaje de técnicas no especiales |
| Distribución de impactos en «1-5» | Uniforme |
| Mantenimiento de la segunda posición del Adepto | `adeptSustain` por invocador; si falta, 1 ronda |
| Cuándo ha tenido turno una criatura (contadores, Quemado) | Si ocupaba posición al declarar y sigue materializada al cierre |
| Técnicas legales que fallarán con seguridad (Puño preciso fuera del primer turno) | Siguen siendo declarables (consumen la acción), se marcan con aviso en el modo interactivo y la IA aleatoria las evita si tiene otra opción |
| Cambios de Velocidad o Prioridad a mitad de ronda | Tras cada Intercambio y cada acción se recalcula el orden de las pendientes; los empates ya sorteados se conservan y los nuevos se sortean al 50% |
| Acciones mientras se carga | Solo ejecutar la carga o Intercambiar |
| Materializar una criatura completa en una posición vacía | Permitido al inicio de ronda, ordenado por Velocidad |
| Vitalidad al empezar un combate | Máxima, salvo `hpCurrent` explícito (los estados sí persisten) |
| Reaplicar un estado que ya tiene | Sin efecto |
| Ambos bandos derrotados en la misma ronda | Empate |
| Técnica contra posición vacía | Va contra la otra posición ocupada de ese lado; si no hay ninguna, falla |
| STAB (técnica del mismo tipo que el usuario) | x1,25 al daño bruto, también en duotipos; factor aparte de M y sin aparecer en el log (`config.stabMultiplier`, GAP-STAB) |
| Momento del Reemplazo forzado | Al terminar las acciones de la ronda (o al final del cierre), con su cadena de Entrada completa |
| «A todos» sin curar | Todas las posiciones enemigas ocupadas |
| Puño preciso usado mediante Materialización parcial | Cuenta como primer turno tras materializarse: funciona |
| Hacer retroceder (Puño preciso) | Es efecto secundario; la acción pendiente del objetivo falla y se consume; una carga en curso se conserva; si ya actuó (incluida Esquiva) no hace nada |
| Activación y duración de Campos/Climas/Anomalías | Se activan con la Entrada de su portador y duran hasta ser sustituidos, aunque el portador salga |
| Efectos al impactar en multigolpe | Una vez por objetivo impactado salvo `perHit`; nunca sobre criaturas ya derrotadas |
| Técnicas de contacto | Toda técnica Física (configurable con `contactDefault`) |
| «El daño se reduce X%» | Porcentaje en M; solo «reduce a la mitad» divide (R) |
| «Permanece N rondas» / «las siguientes N rondas» | La primera incluye la ronda de uso; la segunda empieza en la siguiente |
| Efectos temporales sobre una criatura | Desaparecen con cualquier Salida |
| «Tras causar daño» | Exige pérdida real de Vitalidad > 0 |
| Sustituciones del usuario | «Es sustituido» = Intercambio forzado tras los Reemplazos; «puede retirarse» = Retirada voluntaria opcional |
| «El doble de daño», «+50% de potencia» | Se suman en M (+100%, +50%) |
| Horda (sin CANON-CREATURES) | Tres cadáveres explícitos por instancia; cada golpe usa su Ataque escalado al NV de Holómicor y el daño de su técnica anatómica |
| «Hasta finalizar la siguiente ronda» para todos los aliados | Efecto de lado de 2 rondas |
| «Todos los aliados» en una Retirada | No incluye a la criatura que se retira |
| Daño porcentual de Climas/Campos | Pérdida fija de Vitalidad máxima, sin tabla de tipos |
| Segundo aliento ante un golpe que deja la Vitalidad en 0 | Actúa antes de la Derrota (28.5.15) y la criatura sigue en pie |
| Presencia opresiva / Presión arcana («disminuye un 50%») | -2 etapas |

---

## Tests

`npm test` ejecuta 160 tests:

- **Escenarios** (`scenarios/sarah_vs_adriano.json`, `scenarios/asesino_vs_adriano.json`): Preparaciones válidas, 40 combates aleatorios por escenario sin errores, cada técnica de daño equipada impacta, y un caso dirigido por cada técnica de Estado, técnica con efecto y Manifestación equipada, usando las propias criaturas del escenario.

- **Datos**: esquemas, referencias cruzadas técnica <-> especie, overrides y cobertura.
- **Fórmulas**: casos canónicos 33 (240 -> 320 -> 400), 20.2 (75% -> 85%), 21.3 (x0,75), 23.5 (1000 / 170), 24.1 (Paralizado + Enraizado = -50%), tabla de etapas 21.2, tipos duales, inmunidades, Profundidad y Esquiva.
- **Validador**: 5 criaturas, 50+50+50 = 150 de coste local, Amplitud excedida, Manifestación duplicada o incompatible, huecos por NV, Fortaleza, técnica especial ajena, línea de Transfiguración y despliegue; devuelve todos los errores a la vez.
- **Pipeline**: despliegue por Velocidad (29, parcial), orden de Intercambios, objetivo por posición (31), Materialización parcial (32), Esquivas 100/50/12,5/0 (17), multigolpe y Reemplazo al final (19.4), carga, Quemado y contadores, Adepto, modo strict, fin de combate, inmutabilidad del estado.
- **Propiedades**: 300 combates aleatorios comprobando los invariantes de la sección 8 de la especificación, más repetición exacta por semilla.

- **Efectos (fase 5)**: despliegue con dos Climas en el que prevalece el de la criatura lenta (29), Entrada rápida que aplica Enraizado y hace fallar el Intercambio rival (30), suma de modificadores en M (Combustión + Juramento = x0,75; Devorallamas = 0), Calima, Llovizna con Rayo que nunca falla bajo Desorientado, Desvinculado y Silencio del Vínculo desactivando Manifestaciones, Ignición una vez por Entrada, Punto de ignición, inmunidad Mítica a Desvinculado, y Puño preciso (retroceso del objetivo, fallo fuera del primer turno, recarga al volver a entrar y uso mediante Materialización parcial).

- **Técnicas**: etapas y restricciones de estado (Enfado, Acelerar bajo Parálisis, Pacto de sangre), curación con Desvinculado, retroceso y drenaje, Barrera de fuerza y su destrucción, Estela y Maraña, sustituciones forzadas u opcionales, «no puede usarse dos turnos consecutivos», Mordisco de presa, Canto final, Bajo mi amparo, Caza espectral, Velocidad invertida, Anular prioridad, Bola de fuego, Aprovechar hueco, Pulso intermitente, Incinerar, Sesteo, Cristal opaco + Prisma de retorno, Caparazón incandescente, Mueca, Helar contra Planta, Aliento de dragón con Calima, Retorno arcano, Infección, Revelación absoluta, Borrar el contorno, Mediodía y Colapso.
- **Propiedades**: los 300 combates aleatorios usan ahora todo el catálogo curado en modo strict (técnicas especiales con su especie, Manifestaciones compatibles al azar) sin errores ni invariantes rotos, incluida Horda con cadáveres al azar.
- **Manifestaciones**: Último hilo, Segundo aliento, Amartillar, Sobrecarga, Horda, Regeneración, Campo rocoso, Tormenta eléctrica, Presagio imposible, Retaguardia, Presencia opresiva + Desafiante, No me toques, Espejo cóncavo, Raíz compartida, Ruptura de afinidad y Negación elemental; el recálculo del orden cuando una acción cambia la Velocidad (Estela) y dos cadenas completas (Rebufo con Entradas y Respuestas encadenadas; Reemplazo forzado con Entrada antes de la siguiente acción).

Pendiente: las fases 6 a 8.
