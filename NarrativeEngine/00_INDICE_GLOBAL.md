# Índice global de Somundar

SOURCE_ID: GLOBAL-INDEX
REVISION: 2
FECHA_ACTUALIZACION: 2026-09-28
FECHA: 2026-09-28
RESPONSABILIDAD: único mapa global de recuperación
AUTORIDAD: índice derivado; no sustituye fuentes

## Entrada: interpretar → localizar → consultar → verificar → trabajar

Determina operación, alcance, versión y corte temporal. Sigue las rutas de este mapa y consulta el contenido de la fuente vigente antes de afirmar hechos importantes. No cargues todos los contenedores por defecto. Los encabezados y términos que siguen son localizadores semánticos, no herramientas ni enlaces que abran solos los archivos.

SOURCE_ID identifica una responsabilidad estable. Un contenedor puede reunir varios SOURCE_ID, delimitados por `INICIO_FUENTE` y `FIN_FUENTE`. El nombre físico observado se conserva en SOURCE-MANIFEST como metadato; no gobierna autoridad ni versión. Una referencia antigua se resuelve por contenido y función, no eliminando a ciegas su sufijo.

## 1. Disponibilidad y cobertura antes de consultar

| Recurso | Estado vigente | Qué permite y qué no |
|---|---|---|
| Ocho fuentes de contenido vigentes | Completas; seis actualizadas a r2, STYLE-GUIDE y CANON-SOLMER conservan r1 | Consultar normas, fichas, hitos documentados y estilo, con periodo y estado de cada sección. |
| CANON-NOVELS | Dossier unificado presente | Consultar su reconstrucción y conocimiento de autor; no reemplaza la evidencia narrativa ni acredita que hayamos leído los manuscritos. |
| NOVEL-DESPERTAR / NOVEL-VALERIO / NOVEL-UNIVERSIDAD | Referenciados por el dossier, cuerpos ausentes | No hay pasajes íntegros que puedan recuperarse de ellos en esta entrega. |
| CONTINUITY-INDEX | SIN_INDEXAR en narrativa; controles de autor incorporados | No contiene escenas verificadas. Sí localiza el secreto de filiación y la planificación aprobada de IV, con su procedencia explícita. |
| Mapas y guía de novelas separada | No adjuntos | No inventar lectura visual ni rellenar su contenido. Sí hay planificación dentro de CANON-NOVELS. |
| CORE-LEGACY / CANON-TEACHERS-LEGACY | Históricos, fuera de carga habitual | Sólo antecedentes; no son normas ni episodios activos. |

Si una consulta se resuelve con el dossier, responde atribuyendo «según CANON-NOVELS» y delimita lo que no se puede contrastar. Para una revisión integral o una cita de novela, hace falta el texto. No interrumpas una consulta de mecánicas o estilo por la ausencia de manuscritos si no son pertinentes.

## 2. Directorio de fuentes y responsabilidades

| SOURCE_ID | Responsabilidad y autoridad | Ubicación de entrega y ruta interna | Periodo / cobertura |
|---|---|---|---|
| CORE-PROJECT | Coordinación vigente | Campo Instrucciones del Proyecto | Todas las operaciones; sustituye CORE-LEGACY. |
| STYLE-GUIDE | Autoridad sobre cómo escribir y evaluar | EDITORIAL-HANDBOOK, bloque de ese SOURCE_ID | Transversal; sus ejemplos no son canon. |
| EDITORIAL-PROCEDURES | Modos de tarea, alcance y mantenimiento | EDITORIAL-HANDBOOK | Usar sólo el procedimiento pertinente. |
| SOURCE-MANIFEST | Identidad, revisión, procedencia y relaciones | EDITORIAL-HANDBOOK | Registro de fuentes, incluidas ausencias e históricos. |
| SOURCE-ISSUES | Conflictos, límites y sustituciones detectadas | EDITORIAL-HANDBOOK | Registro inicial, ampliable; no auditoría exhaustiva. |
| CANON-DECISIONS | Decisiones explícitas, alcance y aplicación | EDITORIAL-HANDBOOK | DEC-001 a DEC-006 aplicadas: estados, secreto, objetos, cierre IV, Ruptura de Afinidad y Materialización parcial. |
| CONTINUITY-STANDARD | Estructura y evidencia de índices narrativos | EDITORIAL-HANDBOOK | Para indexar, interpretar o reparar registros. |
| INDEXING-PROMPT | Encargo reutilizable de indexación | EDITORIAL-HANDBOOK | Ejecutar por petición; no es una tarea automática al leerlo. |
| CANON-WORLD | Mundo, culturas, metafísica, materiales y relaciones regionales | WORLD-CORPUS; «Somundar» | Marco general; restricciones y vacíos explícitos. |
| CANON-SOLMER | Geografía, instituciones, política, economía y cultura imperial | WORLD-CORPUS; «Imperio de Solmer» | Presente declarado de novela II. |
| CANON-NOVELS | Personajes, profesores, secretos e hitos reconstruidos | CHARACTER-CORPUS; tres partes originales | I–III; estados históricos y cierre III; planes IV–VIII separados por rótulos. |
| CANON-CREATURES | Especies, anatomía, estadísticas, formas y aprendizaje | CREATURE-CORPUS; 160 fichas numeradas | No demuestra aprendizaje o estado de cada individuo. |
| CANON-MECHANICS | Regla general de invocación, progresión y resolución | SYSTEM-CORPUS; «Mecánicas de invocación de Somundar» | Prevalencia mecánica declarada. |
| CANON-TECHNIQUES | Parámetros, efectos, condiciones y excepciones de técnicas | SYSTEM-CORPUS; «Compendio de técnicas Somundar — revisión 2» | Repertorio; no acceso universal por compartir elemento. |
| CANON-MANIFESTATIONS | Repertorio, efectos, acceso, equipamiento y transmisión | SYSTEM-CORPUS; «Manifestaciones del Vínculo…» | Existencia no implica conocimiento humano. |
| NOVEL-* | Texto íntegro aceptado y hechos narrados | NARRATIVE-CORPUS | Inicialmente ausente; consulta su registro antes de atribuirle un pasaje. |
| CONTINUITY-INDEX | Localización de escenas, estados y dependencias | CONTINUITY-INDEX | Cobertura narrativa SIN_INDEXAR; controles de autor separados en 4.1, 5.1 y 9.1. |

Contenedores físicos de esta entrega: EDITORIAL-HANDBOOK = 01_DIRECCION_EDITORIAL.md; WORLD-CORPUS = 02_MUNDO_Y_SOLMER.md; CHARACTER-CORPUS = 03_PERSONAJES_Y_TRAYECTORIAS.md; CREATURE-CORPUS = 04_CRIATURAS.md; SYSTEM-CORPUS = 05_SISTEMA_DE_INVOCACION.md; NARRATIVE-CORPUS = 06_MANUSCRITOS_ACEPTADOS.md; CONTINUITY-INDEX = 07_CONTINUIDAD_NARRATIVA.md. Este mapeo ayuda a instalar; si se renombra un archivo, se sigue su identidad interna.

## 3. Rutas por operación y escala

| Petición | Contexto que se recupera | Resultado / lo que queda fuera |
|---|---|---|
| Escribir una escena o capítulo | Estado al corte → antecedentes causales y asuntos abiertos → conocimiento/relación de participantes → canon de dominios afectados → STYLE-GUIDE | Prosa nueva candidata; no aceptar automáticamente. |
| Continuar capítulo incompleto | Capítulo completo hasta el corte + enlace anterior + dependencias pertinentes | Continuación; conservar el comienzo. |
| Reescribir sólo diálogo | Escena original + propósito/voz/relación/conocimiento + STYLE-GUIDE > Diálogo y subapartados | Cambios en diálogo; conservar literalmente el resto y señalar repercusiones aparte. |
| Revisar escena o capítulo | Texto completo del alcance + criterio y fuentes de hechos discutibles | Informe; no modificar por defecto. |
| Revisar novela integral | Texto íntegro por tramos + vistas de causalidad, personajes, relaciones, información e hilos + STYLE-GUIDE | Hallazgos locales y síntesis transversal. Una lista por capítulo no basta. |
| Analizar diálogos de todo un manuscrito | Todas sus conversaciones y contexto + evolución de interlocutores + STYLE-GUIDE > Diálogo | Diagnóstico de ese aspecto; no reescritura general. |
| Continuidad entre novelas | Cierre y transiciones de ambas + antecedentes de dependencias aún activas + normas implicadas | Comparar estados y causas con fuentes; no cargar las novelas ajenas al problema por rutina. |
| Consultar un hecho | Fuente especializada y periodo, o índice → pasaje narrativo | Respuesta precisa, evidencia y limitación si falta fuente. |
| Comparar dos versiones | Identidad/estado de ambas + mismo alcance + propósito + criterio de estilo/canon | Evaluación; no fusión ni aceptación tácita. |
| Proponer o evaluar cambio | Estado actual + reglas afectadas + dependencias futuras | Alternativas hipotéticas y consecuencias; no canonizar. |
| Indexar texto | SOURCE-MANIFEST → CONTINUITY-STANDARD → INDEXING-PROMPT → texto íntegro disponible | Actualizar registros y cobertura, sin modificar la prosa. |

## 4. Recuperar conocimiento y relaciones

| Consulta | Ruta verificable | Precaución |
|---|---|---|
| ¿Quién conoce la verdad biológica de Aster, Marco y Adriano? | CANON-NOVELS > Secreto de filiación de Aster, Marco y Adriano — DEC-002; índice de conocimiento y seis fichas; CONTINUITY-INDEX > 5.1 | Sólo los seis fijados por el autor hasta revelación explícita. Filiación legal, biológica y paternidad de Alex son cuestiones distintas. |
| ¿Qué sabe Adriano sobre X en ese capítulo? | CONTINUITY-INDEX > Información, TOPIC_ID X + Adriano + corte → adquisición/corrección → pasajes; complemento CANON-NOVELS > Adriano > conocimiento histórico o cierre III | El índice rápido al cierre III no sirve como estado de un capítulo anterior. |
| ¿Qué sabe el lector que ignora el POV? | Información de lector al orden de lectura + información del personaje al tiempo de escena → fuentes separadas | Conocimiento de autor no revela nada al lector por sí solo. «No consta» no prueba ignorancia. |
| ¿Qué pistas conoce el lector? | CONTINUITY-INDEX > Asuntos abiertos + Información del lector → aperturas/refuerzos/revelaciones anteriores al corte | Pista vista no equivale a solución comprendida. |
| ¿Qué pasó entre Aster y Adriano antes de esto? | CONTINUITY-INDEX > Relaciones, Adriano ↔ Aster → hitos previos, escenas y consecuencias; CANON-NOVELS > ambos perfiles e hitos de formación | Filiación legal real, ausencia de filiación biológica y conocimiento del secreto se consultan por separado; DEC-002 fija quién lo sabe. |
| ¿Dónde están todas las escenas de esa relación? | Directorio de RELATION_ID + apariciones/referencias de cada entidad → texto de todo el alcance | Incluir conversaciones sobre el ausente, recuerdos y efectos; comprobar cobertura antes de decir «todas». |
| ¿Cuál es el último estado de Risco? | Estados por individuo y corte → cambios anteriores; complemento CANON-NOVELS > Risco y Progresión | No usar Valdrakar planificado como estado narrado ni ficha de especie como individuo. |
| ¿Dónde se estableció esta descripción? | CONTINUITY-INDEX > Primeras apariciones y rasgos → pasaje; para compatibilidad, CANON-NOVELS/CANON-CREATURES | Distinguir primera mención, primera visualización, especie, forma e individuo. |
| ¿Qué consecuencia sigue abierta? | THREAD_ID → apertura/hitos/cierre + estados al corte → fuentes | Ausencia de mención no acredita cierre. |
| ¿Qué originó este efecto hace capítulos? | Evento actual → enlace causal/habilitación → fuente de origen → estados persistentes | No inventar un enlace causal donde sólo hay sucesión. |

Estas rutas están definidas y son utilizables al incorporar el texto. Inicialmente no hay registros narrativos que permitan completar sus pasos sin los manuscritos. El dossier sí permite encontrar los temas y las declaraciones existentes, con atribución documental.

## 5. Entidades prioritarias, alias y desambiguación

Los siguientes son términos de búsqueda, no declaraciones exhaustivas de identidad pública o conocimiento. Las relaciones se comprueban en sus fuentes antes de atribuirlas a personajes. Los alias públicos/secretos y su vigencia se registran en continuidad cuando exista respaldo narrativo.

| Entidad / términos | Localizador canónico | Dependencias y consultas relacionadas |
|---|---|---|
| Adriano Valerio; Adriano | CANON-NOVELS > PERSONAJES > 4.1. Adriano Valerio; PROGRESIÓN DE ADRIANO | Aster, Marco, Helena, Cassaro, Sarah, Silvia, Brenn; rango real/reconocido/certificado; aprendizaje y conocimiento. |
| Aster Valerio; Aster | CANON-NOVELS > 1.1. Aster Valerio; Índice canónico de conocimiento | Formación, familia, secretos, ausencias y transmisión posterior. |
| Risco | CANON-NOVELS > 4.1.A. Risco; PROGRESIÓN > novela IV | Brasal/Dracendra/Valdrakar son formas, no alias universales. Ruptura de Afinidad se adquiere al transfigurar en Valdrakar en el plan IV (DEC-005); consultar fichas 1–3 y corte temporal. |
| Mota | CANON-NOVELS > 4.1.B. Mota; PROGRESIÓN | Nimburu/Nimbaro/Nimburai, CANON-CREATURES 13–15; Formación de Caza, Oportunista, Estela, Rebufo. |
| Brumarina de Adriano; antes Eosmis | CANON-NOVELS > 4.1.C. Brumarina (antes Eosmis) | Distinguir individuo y especies Eosmis/Brumarina/Tempestral, fichas 66–68; transmisión/equipamiento. |
| Náyara de Adriano; antes Gútula | CANON-NOVELS > 4.1.D. Náyara (antes Gútula) | Distinguir individuo, especie y forma futura; localizar Gútula/Náyara/Undaria en CANON-CREATURES. |
| Sarah Ordan; Sarah | CANON-NOVELS > 1.2. Sarah Ordan; CANON-SOLMER > Universidad | Dirección, conocimiento, evaluación, máxima laurea; separar planes posteriores. |
| Marco Valerio; Marco; Helena; Olivia; Alex | CANON-NOVELS > Villa Ámbrela y entorno familiar de los Valerio | Historia y secretos familiares; no sustituir Helena por nombres parecidos. |
| Cassaro Valerio; Cassaro | CANON-NOVELS > 3.1. Cassaro Valerio | Secreto de rango, familia y Proyección de patrón; separar saber del lector/personajes. |
| Silvia Vardana; Silvia | CANON-NOVELS > Promoción > 5. Silvia Vardana | Relación y trabajo con Adriano; Estela; escenas y cambios de confianza. |
| Brenn Veyr; Brenn; familia Veyr; Hagen | CANON-NOVELS > 10. Brenn Veyr; Familia Veyr | Identidad pública, conocimiento de autor, relación con Adriano y criaturas individuales. |
| Maelle Vaurin; Maelle; Casa Auvrelle | CANON-NOVELS > 2. Maelle Vaurin; Familia real de Corona Azur | Cobertura, familia y secreto; no fusionar identidades sin leer el apartado. |
| Ciro Lurigan; Valco; Flavia Valco; Sabina Cerio; Gabino Varo | CANON-NOVELS > Villa Ámbrela | Estados de vida/muerte, experiencias, relaciones y certificación, según momento. |
| Naim; Haruen; Beltrán; Aulo; Lucano; Tacio; Celsa; Vibia; Maro; Mirea | CANON-NOVELS > Personajes incorporados o definidos en Valerio | Aulo de este bloque no se fusiona con Aulo Bragano. |
| Tulia Severina; Gaio Marçal | CANON-NOVELS > apartados con esos nombres | Medición, evaluación, capacidades frente a certificación. |
| Eulalia; Galo; Silvano; Teodora; Domitia; Feliciano; Emilia; Tiberio | CANON-NOVELS > PROFESORES DE LA UNIVERSIDAD | Cátedras, doctrina e intervención real según dossier; no eventos posibles del antecedente. |
| Lucerio IV; Vermina; Terenio; Caelio | CANON-NOVELS > Casa Imperial; CANON-SOLMER > Figuras políticas | Lucerio/Terenio también designan monedas; desambiguar por contexto. |
| Los Veinticuatro; Consejo Imperial; Pacto de los Trece | CANON-NOVELS > Consejo y Composición actual del Pacto; CANON-SOLMER > 4 y 9 | Institución pública, conspiración, afiliación y quién lo sabe son datos distintos. |

El directorio local de CANON-NOVELS incluye el resto de fichas y secciones sin convertirlas en resúmenes. Para personajes menos frecuentes, busca su nombre allí y después sus escenas en CONTINUITY-INDEX.

## 6. Mundo, lugares, política y objetos

| Conceptos / términos útiles | Fuente y encabezados de recuperación |
|---|---|
| inter-esse, metafísica, vida, forma, muerte, liberación | CANON-WORLD > 3. Metafísica; 4. El Vínculo; 8. Muerte y liberación; CANON-MECHANICS para consecuencias operativas. |
| Liran, Corona Azur, Reinos del Viento, Valmor, Mareas, Aurelia, Coralis, Verdantis, Kelanor | CANON-WORLD > Geografía cultural y capítulos propios de cada cultura; para materiales, capítulo 26. |
| Morante, Navegantes de las Corrientes, Arcontes, navegación | CANON-WORLD > 20. Navegantes de las Corrientes; materiales e industria regional; escenas en el dossier y narrativa cuando esté disponible. |
| Solmer, Punta Ámbar, Ámbrela/Villa Ámbrela, Villa Arven, Camino Imperial, Tarsia | CANON-SOLMER > 2. Geografía general; 3. Tarsia; CANON-WORLD > Comercio, viaje e información. |
| Universidad Imperial de Invocadores, cátedras, biblioteca, Coliseo | CANON-SOLMER > 3.2–3.3; CANON-NOVELS > Organización docente, profesores, promoción y progresión; no equiparar distintos recintos sin verificar. |
| rutas, distancias, desplazamientos, postas, mensajería, descanso | CANON-SOLMER > Geografía general y Postas Imperiales; CANON-WORLD > 24; CONTINUITY-INDEX > viajes y cronología para recorridos efectivamente narrados. |
| moneda, precios, lucerio, verminio, terenio, cambio | CANON-SOLMER > 11. Economía y moneda, incluida Relación entre las monedas. |
| Archivo Imperial, Banco de Tarsia, Cofradía de la Traza, autenticidad | CANON-SOLMER > 3–4 y 11; CANON-WORLD > Materiales y objetos > Solmer: la industria de la autenticidad. |
| religión, soberanía, guerra, lenguas, comunicación local | CANON-WORLD > 21–25 y regiones; CANON-SOLMER > Lengua y escritura, Religión y estructuras políticas. |
| objetos integrados, Transfiguración, realidad material e Intermedio; Targor, Dracendra, Corvexan | CANON-WORLD > 4.1.1 y Materiales y objetos > Objetos integrados en Transfiguraciones; CANON-MECHANICS > Intermedio; CANON-CREATURES > regla general y fichas 2, 11, 105; DEC-003. |
| materiales, papel, óptica, talleres, agricultura, transporte, anacronismos | CANON-WORLD > 26. Materiales y objetos; subapartados de oficios, aplicaciones no descubiertas y límites. |

## 7. Combate y progresión: cruzar dominios

No basta con leer la descripción de un ataque. Para un veredicto recupera el estado del individuo al corte y las fuentes que gobiernan cada condición.

| Comprobación | Ruta especializada |
|---|---|
| Individuo, forma, heridas, aprendizajes y equipo actual | Narrativa → CONTINUITY-INDEX como localizador; CANON-NOVELS como dossier atribuido. |
| Anatomía, tamaño, estadística de referencia, técnicas aprendibles y transfiguración | CANON-CREATURES > ficha de la forma concreta y criterios iniciales. |
| Vínculo, Intermedio, materialización, Entrada/Salida, Intercambio | CANON-MECHANICS > 1. Palabras clave; 7. Preparación; 13–18 y 28. |
| Profundidad, NV, Fortaleza, Amplitud, Estamento, simultaneidad | CANON-MECHANICS > 4–12; CANON-NOVELS para capacidad y certificación del personaje. |
| Preparación final de Adriano en IV; Amplitud 290; coste 287,5 | CANON-NOVELS > PLANIFICACIÓN — NOVELA IV — CONSPIRACIONES > Preparación final de Adriano — Novela IV; fichas Risco/Mota/Brumarina/Náyara y Resumen de hitos. DEC-004/005; planificación aprobada, no escena narrada. |
| Cuatro técnicas, coste local y presupuesto global | CANON-MECHANICS > 8; coste de cada técnica en CANON-TECHNIQUES; no confundir carga estable con combustible. |
| Materialización parcial; cualquier técnica preparada; posición activa | CANON-MECHANICS > Materialización parcial, 11.4, 19.5, 32 y regla 34.8; CANON-TECHNIQUES > Reglas de uso; DEC-006. |
| Coexistencia de estados; penalización más severa; Paralizado + Enraizado | CANON-MECHANICS > 24.1, 21.3 y 36; CANON-MANIFESTATIONS > Problemas de estado > Coexistencia e inmunidades; DEC-001. |
| Inmunidad por tipo y duotipo; Mítico; Fuego/Oscuridad; Fuego/Mítico | CANON-MECHANICS > 24.1 y 24.11; CANON-CREATURES > Tipos, problemas de estado e inmunidades; CANON-MANIFESTATIONS > Coexistencia e inmunidades y Mítico. La inmunidad al estado no implica inmunidad al daño. |
| Ruptura de Afinidad; adquisición por Adriano y Risco | CANON-MANIFESTATIONS > Mítico > Raras > Ruptura de Afinidad; CANON-NOVELS > Risco y Transfiguración central de IV; CANON-CREATURES > 3. Valdrakar. DEC-005 distingue efecto general y adquisición individual. |
| Técnica: PB, tipo, clase, objetivo, prioridad, condiciones, efecto | CANON-TECHNIQUES > nombre exacto, incluidos anatómicas, elementales, sin elemento y especiales. |
| Manifestación: acceso, equipo único, disparador, efecto y transmisión | CANON-MANIFESTATIONS > Aprendizaje y equipamiento y nombre; CANON-MECHANICS > 10. |
| Orden, acciones comprometidas, esquiva, simultaneidad, efectos persistentes | CANON-MECHANICS > 13–20, 24–28; comprobar excepciones explícitas. |
| Estadísticas, etapas, tipos, daño, redondeo y límites | CANON-MECHANICS > 21–24 y 35–36; SOURCE-ISSUES ISS-004/005/010. |
| Combate real/formal y protección del invocador | CANON-MECHANICS > 27; STYLE-GUIDE > Combate para representación narrativa. |
| Convertir resolución en escena física causal | STYLE-GUIDE > Combate y sus subapartados; CANON-MECHANICS > 37. Criterio narrativo. |

Términos frecuentes: Estela y Rebufo son rutas al compendio de técnicas; Mundano, Ruptura de Afinidad, Oportunista, Formación de Caza, Filo del Viento, Fluidez Aérea y Marea Reparadora al de Manifestaciones. Sus efectos y quién puede usarlos se consultan, no se infieren del nombre o de una sinergia planificada.

## 8. Estilo como criterio, no como lista de sustituciones

| Necesidad | Secciones de STYLE-GUIDE |
|---|---|
| Voz, naturalidad, español, frases y párrafos | Tradición literaria; Principio general; Prosa narrativa; Continuidad sintáctica; Español literario. |
| Causalidad, estructura y ritmo global | Arquitectura narrativa; Causalidad narrativa: PERO / POR LO TANTO; Ritmo; Progresión, no acumulación; Continuidad. |
| Diálogos y relación entre interlocutores | Diálogo y todos los subapartados pertinentes: directo/indirecto, ping-pong, asimetría, narrador, conocimiento compartido, subtexto, voces, humor y revisión. |
| Descripción y primeras apariciones | Descripción; Fantasía descriptiva; Primera aparición de criaturas; Nombre propio, especie y descriptor morfológico. |
| Psicología, POV y exposición | Psicología; Punto de vista; Percepción individual; Exposición; Personajes antes que estadísticas. |
| Combate y sistema vivido | Combate; Representación narrativa del sistema; Habilidades; Jerarquía narrativa, subordinadas al canon factual. |
| Repeticiones y automatismos | Concisión; Metáforas; Belleza discreta; Evitar prosa reconociblemente generada por IA. |

No usar los ejemplos como escenas aceptadas ni permitir que una pauta superficial destruya información, intención o voz. Consultar también EDITORIAL-PROCEDURES > Estilo y alcance cuando surja conflicto de interpretación.

## 9. Incidencias y versiones: dónde mirar

SOURCE-ISSUES registra: manuscritos ausentes; alcance de autoridad normativa/narrativa; sustitución de profesores; etapas negativas; fórmula de daño abreviada; ejemplos de interfaces; periodos y planificación; mapas/guía ausentes; totales de costes de IV, corregidos por DEC-004 (ISS-009 resuelta); equivalencia de fórmulas de NV. Consulte la incidencia aplicable antes de dar por resuelta una discrepancia.

SOURCE-MANIFEST conserva nombre observado, SOURCE_ID, tipo, autoridad, revisión/relación y destino. CANON-DECISIONS conserva DEC-001 a DEC-006, ya aplicadas, y las decisiones que se incorporen después. Ninguno permite elevar una hipótesis a canon.

## 10. Actualizar este mapa

Añadir o cambiar únicamente responsabilidades, ubicación, cobertura y rutas semánticas que ayuden a recuperar. Los eventos, estados, conocimiento y relaciones detallados viven en CONTINUITY-INDEX y sus fuentes. Las normas completas permanecen en sus especialistas. No crear un segundo índice global ni copiar resúmenes de capítulos aquí.

Si se divide un contenedor para ocupar una plaza libre, conservar SOURCE_ID y cambiar ubicación en este mapa y el manifiesto. Si cambia una versión, actualizar sus rutas y declarar las vistas desactualizadas hasta comprobarlas. El mapa nunca debe ocultar qué corpus falta o qué cobertura es parcial.
