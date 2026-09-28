# Manuscritos aceptados de Somundar

SOURCE_ID: NARRATIVE-CORPUS
REVISION: 1
TIPO: contenedor de fuentes narrativas
ESTADO: preparado; sin cuerpos narrativos incorporados

## Registro de disponibilidad

| SOURCE_ID reservado | Obra referenciada | Aceptación documentada | Disponibilidad | Revisión narrativa | Cobertura |
|---|---|---|---|---|---|
| NOVEL-DESPERTAR | I · Despertar | CANON-NOVELS la identifica como manuscrito final de referencia | AUSENTE | No disponible | SIN_INDEXAR |
| NOVEL-VALERIO | II · Valerio | CANON-NOVELS la identifica como manuscrito final de referencia | AUSENTE | No disponible | SIN_INDEXAR |
| NOVEL-UNIVERSIDAD | III · Universidad | CANON-NOVELS la identifica como manuscrito final de referencia | AUSENTE | No disponible | SIN_INDEXAR |

Los nombres observados dentro de CANON-NOVELS son `Novela_1_Despertar_manuscrito.md`, `Novela_2_Valerio_ManuscritoFinal.md` y `Novela_3_Universidad_manuscrito.md`. Son referencias documentales, no archivos suministrados en esta tarea. No consta aquí qué revisión exacta de los cuerpos corresponde a ellas.

No se ha convertido CANON-NOVELS en capítulos ni se han inventado escenas, citas o separadores. Mientras no se incorpore la narrativa, las consultas al dossier se atribuyen al dossier y sus afirmaciones sobre el manuscrito permanecen sin contraste directo.

## Incorporación de una obra

Utilizar INDEXING-PROMPT y CONTINUITY-STANDARD. Mantener el texto íntegro, la división por obra/capítulo y, cuando sea identificable, la segmentación de escenas. Añadir metadata fuera del cuerpo. Una nueva fuente narrativa necesita SOURCE_ID, revisión, estado de aceptación, origen y delimitación inequívoca.

Plantilla documental, no manuscrito real:

```text
INICIO_OBRA: [NOVEL-ID]
SOURCE_ID: [NOVEL-ID]
REVISION: [revisión del texto]
ESTADO_EDITORIAL: ACEPTADO
ACEPTACION: [decisión documentada]
NOMBRE_FISICO_OBSERVADO: [metadato]
OBRA: [título]
CHAPTER_ID: [estable] / número y título originales
INICIO_TEXTO: [capítulo]
[texto íntegro, sin correcciones incidentales]
FIN_TEXTO: [capítulo]
FIN_OBRA: [NOVEL-ID]
```

Las escenas pueden localizarse mediante anclas externas en CONTINUITY-INDEX, sin insertar encabezados ficticios en la novela. Conservar una sola revisión activa aceptada por obra; las anteriores se archivan fuera de los archivos activos, con relación de sustitución registrada. Un borrador se estudia como trabajo de la conversación y no entra aquí sin aceptación.

## Crecimiento

Si conviene dividir este contenedor entre las plazas libres, hacerlo por obras/arcos completos, conservar los SOURCE_ID y actualizar ubicación en GLOBAL-INDEX y SOURCE-MANIFEST. La separación física no modifica el canon ni permite resumir u omitir capítulos.
