# Simulador de combates de Somundar

Árbitro de duelos de invocación del mundo de Somundar. Resuelve combates entre dos invocadores aplicando las reglas de `NarrativeEngine/05_SISTEMA_DE_INVOCACION.md` (mecánicas, técnicas y Manifestaciones), las fichas de `NarrativeEngine/ficha_completa_de_criaturas.md` y los datos de `Data/`.

- **Determinista y reproducible**: la misma semilla, el mismo escenario y las mismas decisiones producen siempre el mismo combate.
- **Auditable**: cada evento del log indica su causa, la regla aplicada y las tiradas realizadas.
- **Sin reglas inventadas**: cuando el canon no cubre una situación, se aplica un supuesto documentado que puede consultarse con `node dist/app/cli.js gaps`.

Cada combate se describe en un archivo de escenario (JSON) con los dos bandos. Las decisiones de cada bando las toma una IA aleatoria o una persona por consola.

---

## Requisitos

| Herramienta | Versión mínima | Uso |
|---|---|---|
| Node.js | 22 | Compilar y ejecutar el simulador |
| npm | 10 (incluido con Node.js 22) | Instalar las dependencias |
| Python | 3.8 | Opcional: solo para regenerar `Data/` a partir del canon |

TypeScript (5.9) y los tipos de Node se instalan automáticamente como dependencias del proyecto.

---

## Instalación

```bash
# 1. Comprobar las versiones
node -v        # v22.0.0 o superior
npm -v         # 10.0.0 o superior

# 2. Instalar dependencias (desde la raíz del proyecto)
npm install

# 3. Compilar
npm run build

# 4. (Opcional) Comprobar que todo funciona
npm test
```

Si Node.js es más antiguo, instala la versión 22 LTS desde https://nodejs.org o con un gestor de versiones (por ejemplo `nvm install 22`).

Para regenerar la base de datos a partir del canon (solo si se ha modificado `NarrativeEngine/`):

```bash
python3 tools/build_data.py
```

---

## Ejecutar el simulador

Todos los comandos se lanzan desde la raíz del proyecto. Si se modifica el código, hay que volver a ejecutar `npm run build`.

### Simular un combate

```bash
node dist/app/cli.js simulate scenarios/ejemplo_ficticio.json --pretty
```

Sin más opciones, los dos bandos los controla una IA que elige al azar entre las acciones legales.

| Opción | Efecto |
|---|---|
| `--human 0` / `--human 1` / `--human both` | Ese bando lo decides tú por consola |
| `--pretty` | Log en texto legible (se activa solo con `--human`) |
| `--json` | Log completo en JSON |
| `--seed N` | Semilla del combate (por defecto, la del escenario) |
| `--mode strict\|lenient` | `strict` (por defecto) solo permite efectos verificados; `lenient` permite también los no revisados |
| `--data DIR` | Carpeta de datos alternativa (por defecto `Data`) |

Alternativa que compila antes de ejecutar:

```bash
npm run simulate -- scenarios/ejemplo_ficticio.json --pretty
```

### Jugar por consola

```bash
node dist/app/cli.js simulate scenarios/ejemplo_ficticio.json --human 0
```

En cada ronda se muestran:

1. El tablero: Vitalidad, estados y cambios de características de las criaturas en campo, y tus reservas.
2. Las acciones legales numeradas, con sus datos: clase, tipo, Poder Base, Prioridad y alcance. Las no disponibles aparecen con el motivo.
3. La elección del objetivo y, cuando corresponde, de la criatura que entra en un Intercambio o Reemplazo.
4. El resultado de la ronda en texto legible.

Con `--human both` los dos jugadores comparten la misma terminal.

### Otros comandos

```bash
node dist/app/cli.js validate <bando.json>   # valida la Preparación de un bando (sin salida si es válida)
node dist/app/cli.js validate-data           # valida los datos de Data/
node dist/app/cli.js coverage                # técnicas y Manifestaciones disponibles
node dist/app/cli.js gaps                    # supuestos aplicados donde el canon no decide
```

### Crear un escenario

Un escenario es un JSON con la semilla, la configuración y los dos bandos. Hay ejemplos en `scenarios/`.

```jsonc
{
  "seed": 11,
  "config": { "effectsMode": "strict", "maxRounds": 30 },
  "sides": [
    {
      "summoner": {
        "id": "s0", "name": "Invocador A", "estamento": "invocador",
        "amplitude": 250,                  // null = sin límite (Arconte)
        "fortalezaCapacity": 40, "fortalezaMaxPerStat": 20,
        "simultaneity": "stable",          // single | adept_temporary | stable
        "partialMaterialization": true,
        "manifestationRepertoire": ["calima"]
      },
      "preparation": {
        "creatures": [
          {
            "id": "brasal_a", "nickname": "Chispa", "speciesId": "brasal", "nv": 40,
            "fortaleza": { "atk": 20, "spe": 10 }, "orientations": ["atk", "spe"],
            "equippedTechniques": ["golpe_candente", "aranazo"],
            "equippedManifestations": ["calima"],
            "persistentStatuses": []
          }
        ]
      },
      "initialDeployment": ["brasal_a"]
    }
    // ... segundo bando con la misma estructura
  ]
}
```

Campos opcionales de cada criatura:

- `nickname`: nombre que se muestra en lugar del de la especie.
- `hpCurrent`: Vitalidad inicial; por defecto, la máxima.
- `types` y `baseStatsNV50`: por defecto, los de la ficha de la especie. Si se indican otros, se usan y la validación muestra un aviso.
- `canTransfigure`: indica si la criatura todavía puede transfigurarse; por defecto, sí cuando la especie tiene una forma siguiente.
- `horde`: cadáveres de Holómicor para la técnica Horda (`speciesId`, `techniqueId` y, si la especie no está en la guía, `atkNV50`); se reutilizan en ciclo.
- `corpseCount`: cadáveres que controla la colonia de Holómicor. Multiplica la Vitalidad máxima (×1 con un cadáver, ×11 con 100) y aumenta los impactos de Horda con rendimientos decrecientes. Sin indicarlo, la Vitalidad no cambia y Horda hace 3 impactos.
- `materializedCorpseCount`: cadáveres presentes para Horda; por defecto, `corpseCount`.

La línea de transfiguración y las formas anteriores salen de la ficha. La validación comprueba que cada técnica equipada se aprenda con el NV de la criatura y que el NV alcance el mínimo de su forma.
