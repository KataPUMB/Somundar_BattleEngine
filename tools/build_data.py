#!/usr/bin/env python3
"""Genera la base de datos JSON de Data/ a partir de NarrativeEngine/*.md."""
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENGINE = ROOT / "NarrativeEngine"
DATA = ROOT / "Data"
SYSTEM = ENGINE / "05_SISTEMA_DE_INVOCACION.md"
CREATURES = ENGINE / "ficha_completa_de_criaturas.md"

EM = "\u2014"
EN = "\u2013"
TIMES = "\u00d7"

TYPE_IDS = {
    "fuego": "fuego", "agua": "agua", "tierra": "tierra", "aire": "aire",
    "rayo": "rayo", "planta": "planta", "luz": "luz", "oscuridad": "oscuridad",
    "oscuro": "oscuridad", "mitico": "mitico",
}
TYPE_NAMES = {
    "fuego": "Fuego", "agua": "Agua", "tierra": "Tierra", "aire": "Aire", "rayo": "Rayo",
    "planta": "Planta", "luz": "Luz", "oscuridad": "Oscuridad", "mitico": "M\u00edtico",
}
RARITIES = {
    "tipica": "tipica", "tipicas": "tipica", "comun": "comun", "comunes": "comun",
    "rara": "rara", "raras": "rara", "muy rara": "muy_rara", "muy raras": "muy_rara",
    "super super rara": "super_super_rara",
}
TARGETS = {"objetivo unico": "single", "multiobjetivo": "multi", "a todos": "all"}
CLASSES = {"fisica": "physical", "magica": "magical", "estado": "status"}
STATUS_BY_NAME = {
    "quemado": "quemado", "quemarlo": "quemado", "saturado": "saturado",
    "enraizado": "enraizado", "enraizados": "enraizado", "agrietado": "agrietado",
    "agrietados": "agrietado", "paralizado": "paralizado", "paralizados": "paralizado",
    "desorientado": "desorientado", "desorientados": "desorientado",
    "espiritu cercenado": "espiritu_cercenado", "desvinculado": "desvinculado",
    "desvinculados": "desvinculado", "quemados": "quemado", "saturados": "saturado",
}
STATUS_RE = "quemado|saturado|enraizado|agrietado|paralizado|desorientado|espiritu cercenado|desvinculado"
STAT_IDS = {"ataque": "atk", "ataque magico": "matk", "defensa": "def",
            "defensa magica": "mdef", "velocidad": "spe"}


def norm(text):
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", text).strip().lower()


def slug(text):
    return re.sub(r"[^a-z0-9]+", "_", norm(text)).strip("_")


def num(text):
    return float(text.replace(",", "."))


def type_id(text):
    return TYPE_IDS.get(norm(text))


def source_block(lines, source_id):
    start = lines.index("INICIO_FUENTE: " + source_id)
    end = lines.index("FIN_FUENTE: " + source_id)
    return start + 1, lines[start + 1:end]


def strip_md(text):
    return re.sub(r"\*+", "", text).strip()


def cells(row):
    return [c.strip() for c in row.strip().strip("|").split("|")]


# ---------------------------------------------------------------- tecnicas

def parse_power(raw):
    if raw in (EM, "-", ""):
        return None
    m = re.fullmatch(r"Variable\s*" + TIMES + r"\s*(\d+)", raw)
    if m:
        hits = int(m.group(1))
        return {"base": None, "perHit": "variable", "hits": {"min": hits, "max": hits}, "effective": None}
    m = re.fullmatch(r"(\d+)\s*" + TIMES + r"\s*(\d+)(?:\s*[" + EN + r"-]\s*(\d+))?", raw)
    if m:
        per_hit, lo = int(m.group(1)), int(m.group(2))
        hi = int(m.group(3)) if m.group(3) else lo
        avg_hits = 2.5 if (lo, hi) == (1, 5) else (lo + hi) / 2
        return {"base": None, "perHit": per_hit, "hits": {"min": lo, "max": hi},
                "effective": per_hit * avg_hits}
    value = int(raw)
    return {"base": value, "perHit": value, "hits": {"min": 1, "max": 1}, "effective": value}


def derive_technique_mechanics(desc):
    d = norm(desc)
    mech = {}

    chances = []
    for m in re.finditer(r"(\d+)% de (?:aplicar |quedar )?(" + STATUS_RE + r"|quemarlo)", d):
        chances.append({"status": STATUS_BY_NAME[m.group(2)], "chance": int(m.group(1))})
    for m in re.finditer(r"aplica (" + STATUS_RE + r")(?: con (\d+)% de probabilidad)?", d):
        chances.append({"status": STATUS_BY_NAME[m.group(1)], "chance": int(m.group(2) or 100)})
    if chances:
        mech["statusChances"] = chances

    m = re.search(r"retroceso:+ (\d+)% del dano infligido", d)
    if m:
        mech["recoilPctOfDamage"] = int(m.group(1))
    m = re.search(r"(?:^|el usuario )pierde (\d+(?:,\d+)?)% de (?:su )?vitalidad maxima", d)
    if m:
        mech["selfDamagePctMaxHp"] = num(m.group(1))
    m = re.search(r"recupera (\d+)% de la vitalidad maxima del usuario", d)
    if m:
        mech["healPctMaxHpSelf"] = int(m.group(1))
    m = re.search(r"recupera vitalidad equivalente al (\d+)% del dano infligido", d)
    if m:
        mech["drainPctOfDamage"] = int(m.group(1))
    if "primer turno:" in d and "segundo turno" in d:
        mech["charge"] = True
    if "no puede usarse dos turnos consecutivos" in d:
        mech["noConsecutiveUse"] = True
    if re.search(r"es sustituido|retirarse voluntariamente y ser sustituido|puede ser sustituido inmediatamente|fuera del campo", d):
        mech["selfSwitchAfterHit"] = True
    if "ignora restricciones de retirada" in d:
        mech["ignoresWithdrawRestrictions"] = True
    if re.search(r"ignora (?:la )?defensa magica", d):
        mech["ignoresDefense"] = "magical"
    elif re.search(r"ignora (?:la )?defensa del objetivo", d):
        mech["ignoresDefense"] = "physical"
    if re.search(r"(?:usa|utiliza) la defensa del usuario en lugar de su ataque", d):
        mech["usesUserDefenseAsAttack"] = True
    m = re.search(r"destruye (barrera de fuerza|zona antimagia|estela) antes de calcular el dano", d)
    if m:
        mech["destroysBeforeDamage"] = slug(m.group(1))
    m = re.search(r"contra criaturas de (\w+) (?:u|o) (\w+), se considera supereficaz", d)
    if m:
        mech["forcedSuperEffectiveVs"] = [type_id(m.group(1)), type_id(m.group(2))]
    m = re.search(r"permanece (\d+) rondas en el lado aliado", d)
    if m:
        mech["sideEffectRounds"] = int(m.group(1))

    stages = []
    for sentence in re.split(r"\.\s*", d):
        if "todas las criaturas presentes" in sentence:
            target = "all_present"
        elif "del objetivo" in sentence:
            target = "target"
        else:
            target = "self"
        for m in re.finditer(r"\b(sube|subir|baja|bajar)( mucho)? (?:el |la |su )?(ataque magico|ataque|defensa magica|defensa|velocidad)"
                             r"(?: y (?:la |el |su )?(ataque magico|ataque|defensa magica|defensa|velocidad))?", sentence):
            amount = (2 if m.group(2) else 1) * (1 if m.group(1).startswith("sub") else -1)
            chance = re.search(r"(\d+)% de probabilidad de " + m.group(1), sentence)
            for stat in (m.group(3), m.group(4)):
                if stat:
                    move = {"stat": STAT_IDS[stat], "stages": amount, "target": target}
                    if chance:
                        move["chance"] = int(chance.group(1))
                    stages.append(move)
    if stages:
        mech["statStages"] = stages
    return mech


def parse_techniques(lines, offset):
    techniques = []
    category = None
    element = None
    species_ctx = None
    categories = {"tecnicas anatomicas": "anatomical", "tecnicas elementales": "elemental",
                  "tecnicas sin elemento": "no_element", "tecnicas especiales": "special"}
    i = 0
    while i < len(lines):
        line = lines[i]
        h2 = re.match(r"^## (.+)$", line)
        if h2:
            category = categories.get(norm(h2.group(1)), category)
            species_ctx = None
        if category == "elemental":
            h3 = re.match(r"^### (\S+)$", line)
            if h3 and type_id(h3.group(1)):
                element = type_id(h3.group(1))
        if category == "special":
            sp = re.match(r"^### (\d+)\. (.+?)(?: " + EM + r" .+)?$", line)
            if sp:
                species_ctx = (int(sp.group(1)), sp.group(2).strip())

        heading = re.match(r"^#{3,4} (.+)$", line)
        nxt = next((l for l in lines[i + 1:i + 3] if l.strip()), "")
        if heading and nxt.startswith("**Tipo:**"):
            name = heading.group(1).strip()
            species = None
            sp = re.match(r"^(\d+)\. (.+?) " + EM + r" (.+)$", name)
            if sp:
                species = {"number": int(sp.group(1)), "name": sp.group(2).strip()}
                name = sp.group(3).strip()
            elif category == "special" and species_ctx:
                species = {"number": species_ctx[0], "name": species_ctx[1]}

            j = i + 1
            meta, rarity, row, desc = "", None, None, []
            while j < len(lines) and not re.match(r"^#{1,4} ", lines[j]):
                l = lines[j]
                if l.startswith("**Tipo:**"):
                    meta = l
                elif l.startswith("**Rareza:**"):
                    rarity = RARITIES.get(norm(strip_md(l.split(":**", 1)[1])))
                elif l.startswith("|") and "Poder base" not in l and "---" not in l:
                    row = cells(l)
                elif l.startswith("**Descripci"):
                    desc.append(l.split(":**", 1)[1].strip())
                elif desc and l.strip():
                    desc.append(l.strip())
                j += 1

            tm = re.match(r"\*\*Tipo:\*\* (.+?) \u00b7 \*\*Clase:\*\* (.+)$", meta)
            description = " ".join(desc)
            accuracy = row[1].rstrip("%")
            technique = {
                "id": slug(name),
                "name": name,
                "category": category,
                "type": type_id(tm.group(1)),
                "class": CLASSES[norm(tm.group(2))],
                "power": parse_power(row[0]),
                "accuracy": int(accuracy) if accuracy.isdigit() else row[1],
                "bondCost": num(row[2]),
                "priority": int(row[3].replace("+", "")),
                "targeting": TARGETS[norm(row[4])],
                "rarity": rarity,
                "species": species,
                "description": description,
                "mechanics": derive_technique_mechanics(description),
                "source": {"id": "CANON-TECHNIQUES", "line": offset + i + 1},
            }
            if category == "elemental" and technique["type"] != element:
                raise ValueError("Tipo inconsistente en " + name)
            techniques.append(technique)
            i = j
            continue
        i += 1
    return techniques


# ---------------------------------------------------------- manifestaciones

def derive_manifestation(label, text):
    d = norm(text)
    lab = norm(label or "")
    kind = {"clima": "weather", "campo": "field", "anomalia": "anomaly"}.get(lab.split(" ")[0]) if lab else None
    if kind:
        trigger = "environment"
    elif d.startswith("al entrar") or lab.startswith("entrada"):
        trigger = "on_entry"
    elif "al retirarse voluntariamente" in d:
        trigger = "on_voluntary_withdraw"
    elif d.startswith("al retirarse"):
        trigger = "on_withdraw"
    elif "cada vez que es sustituido" in d:
        trigger = "on_switch_out"
    elif re.match(r"(cuando|cada vez|al recibir|la primera vez que su vitalidad)", d) or "respuesta" in lab \
            or "fuese a derrotar" in d:
        trigger = "response"
    elif "al final de cada turno" in d or "por turno" in d:
        trigger = "passive_periodic"
    else:
        trigger = "passive"

    mech = {}
    bonus, conditional = {}, []
    for sentence in re.split(r"[.;]\s*", d):
        nxt = re.search(r"la siguiente tecnica (?:de )?(\w+)( utilizada despues de entrar)? causa \+(\d+)%", sentence)
        if nxt:
            t = "mitico" if nxt.group(1).startswith("mitic") else type_id(nxt.group(1))
            mech["nextTechniqueBonus"] = {"type": t, "pct": int(nxt.group(3)), "afterEntryOnly": bool(nxt.group(2))}
            continue
        for m in re.finditer(r"tecnicas (?:de )?(\w+) (?:causan )?([+-]\d+)%(?: de dano)?(.*)", sentence):
            t = "mitico" if m.group(1).startswith("mitic") else type_id(m.group(1))
            if not t:
                continue
            if m.group(3).strip().startswith("contra"):
                conditional.append({"type": t, "pct": int(m.group(2)), "condition": m.group(3).strip()})
            else:
                bonus[t] = int(m.group(2))
    if bonus:
        mech["damageDealtByTypePct"] = bonus
    if conditional:
        mech["conditionalDamageDealt"] = conditional
    received = {}
    for m in re.finditer(r"dano (?:de )?(\w+) recibido -(\d+)%", d):
        t = type_id(m.group(1))
        if t:
            received[t] = -int(m.group(2))
    if d.startswith("dano recibido:"):
        for m in re.finditer(r"(fuego|agua|aire|planta|tierra|rayo) -(\d+)%", d):
            received[type_id(m.group(1))] = -int(m.group(2))
    if received:
        mech["damageTakenByTypePct"] = received
    m = re.search(r"dano de tecnicas fisicas recibido -(\d+)%", d)
    if m:
        mech["physicalDamageTakenPct"] = -int(m.group(1))
    m = re.search(r"dano de tecnicas magicas recibido -(\d+)%", d)
    if m:
        mech["magicalDamageTakenPct"] = -int(m.group(1))
    m = re.search(r"al entrar, todos los enemigos quedan (?:con )?(" + STATUS_RE + r"|\w+)", d)
    if m and m.group(1) in STATUS_BY_NAME:
        mech["entryStatusAllEnemies"] = STATUS_BY_NAME[m.group(1)]
    if "funciona aunque desvinculado" in d:
        mech["worksWhileDesvinculado"] = True
    if "afecta a ambos bandos" in d:
        mech["affectsBothSides"] = True
    if "solo puede repetir esa tecnica" in d:
        mech["locksFirstTechnique"] = True
    return trigger, kind, mech


def parse_manifestations(lines, offset):
    manifestations = []
    element, rarity, global_rarity, in_globals = None, None, None, False
    i = 0
    while i < len(lines):
        line = lines[i]
        h1 = re.match(r"^# (.+)$", line)
        if h1:
            clean = norm(re.sub(r"^\W+", "", h1.group(1)))
            in_globals = clean.startswith("globales ")
            if in_globals:
                element = "global"
                global_rarity = RARITIES[clean[len("globales "):]]
            else:
                element = type_id(clean)
                rarity = None
            i += 1
            continue

        name = None
        if element and not in_globals:
            h2 = re.match(r"^## (.+)$", line)
            if h2:
                rarity = RARITIES.get(norm(h2.group(1)))
            h3 = re.match(r"^### (.+)$", line)
            if h3 and rarity:
                name = h3.group(1).strip()
        elif in_globals:
            h2 = re.match(r"^## (.+)$", line)
            if h2:
                name = h2.group(1).strip()

        if name:
            j = i + 1
            label, body = None, []
            while j < len(lines) and not re.match(r"^#{1,3} ", lines[j]) and lines[j].strip() != "---":
                l = lines[j].strip()
                if l:
                    if label is None and not body and re.fullmatch(r"\*\*[^*]+\*\*", l):
                        label = strip_md(l)
                    else:
                        body.append(strip_md(l))
                j += 1
            notes = [b for b in body if norm(b).startswith("adquisicion individual")]
            effect = [b for b in body if b not in notes]
            text = " ".join(effect)
            trigger, kind, mech = derive_manifestation(label, text)
            manifestations.append({
                "id": slug(name),
                "name": name,
                "element": element,
                "rarity": global_rarity if in_globals else rarity,
                "label": label,
                "trigger": trigger,
                "environmentKind": kind,
                "effect": effect,
                "text": text,
                "mechanics": mech,
                "notes": notes,
                "source": {"id": "CANON-MANIFESTATIONS", "line": offset + i + 1},
            })
            i = j
            continue
        i += 1
    return manifestations


# ------------------------------------------------------- tipos y estados

def parse_type_chart(lines, offset):
    start = next(i for i, l in enumerate(lines) if l.startswith("## 22.1."))
    defenders = [type_id(h) for h in cells(lines[start + 2])[1:]]
    chart = {}
    for l in lines[start + 4:start + 13]:
        row = cells(l)
        chart[type_id(strip_md(row[0]))] = {d: num(c.replace(TIMES, "")) for d, c in zip(defenders, row[1:])}
    return {
        "types": [{"id": t, "name": TYPE_NAMES[t]} for t in defenders],
        "effectiveness": chart,
        "dualTypeRule": "multiply",
        "sameTypeBonus": False,
        "immunities": {
            "fuego": ["quemado"], "agua": ["saturado"], "planta": ["enraizado"],
            "tierra": ["agrietado"], "rayo": ["paralizado"], "aire": ["desorientado"],
            "luz": ["espiritu_cercenado"], "oscuridad": ["desvinculado"],
            "mitico": ["espiritu_cercenado", "desvinculado"],
        },
        "notes": [
            "effectiveness[atacante][defensor] (CANON-MECHANICS 22.1).",
            "Duotipo: los multiplicadores defensivos se multiplican (22.2).",
            "Sin bonificacion implicita por afinidad de tipo (22.2, 23.6).",
            "La inmunidad al estado no implica inmunidad al dano (24.1).",
        ],
        "source": {"id": "CANON-MECHANICS", "line": offset + start + 1},
    }


STATUS_CONDITIONS = [
    {"id": "quemado", "name": "Quemado", "element": "fuego",
     "statModifiersPct": {"def": -50}, "damageOverTime": {"pctMaxHp": 6.25, "timing": "end_of_own_turn"},
     "restrictions": [], "section": "24.3"},
    {"id": "saturado", "name": "Saturado", "element": "agua",
     "statModifiersPct": {"matk": -50},
     "restrictions": [{"kind": "stat_cannot_increase", "stat": "matk", "turns": 5}], "section": "24.4"},
    {"id": "enraizado", "name": "Enraizado", "element": "planta",
     "statModifiersPct": {"spe": -25},
     "restrictions": [{"kind": "no_voluntary_withdraw", "turns": 2}], "section": "24.5"},
    {"id": "agrietado", "name": "Agrietado", "element": "tierra",
     "statModifiersPct": {"atk": -50},
     "restrictions": [{"kind": "stat_cannot_increase", "stat": "atk", "turns": 5}], "section": "24.6"},
    {"id": "paralizado", "name": "Paralizado", "element": "rayo",
     "statModifiersPct": {"spe": -50},
     "restrictions": [{"kind": "stat_cannot_increase", "stat": "spe", "turns": 5}], "section": "24.7"},
    {"id": "desorientado", "name": "Desorientado", "element": "aire",
     "statModifiersPct": {"accuracy": -25},
     "restrictions": [{"kind": "no_same_technique_consecutive", "turns": 5}], "section": "24.8"},
    {"id": "espiritu_cercenado", "name": "Esp\u00edritu Cercenado", "element": "luz",
     "statModifiersPct": {"atk": -25, "matk": -25},
     "restrictions": [{"kind": "dual_type_benefits_halved", "turns": 5}], "section": "24.9"},
    {"id": "desvinculado", "name": "Desvinculado", "element": "oscuridad",
     "statModifiersPct": {"healingReceived": -25},
     "restrictions": [{"kind": "manifestations_disabled", "turns": 5,
                       "except": "worksWhileDesvinculado"},
                      {"kind": "bond_communication_cut", "turns": 5}], "section": "24.10"},
]

STATUS_RULES = {
    "coexistence": "Todos pueden coexistir salvo inmunidad; aplicar uno no elimina otro.",
    "sameStatPenalty": "most_severe_only",
    "persistence": "Persisten tras Salida, reentrada y fin de combate hasta curarse.",
    "turnCounters": "Solo avanzan en turnos propios materializados; el Intermedio los congela.",
    "source": "CANON-MECHANICS 24.1-24.11",
}


# ---------------------------------------------------------------- criaturas

SHEET_STATS = {"ataque fisico": "atk", "ataque magico": "matk", "defensa": "def",
               "defensa magica": "mdef", "velocidad": "spe", "vitalidad": "hp"}
MIDDOT = "\u00b7"


def parse_transfiguration(raw):
    value = norm(strip_md(raw))
    m = re.match(r"^nivel (\d+)", value)
    if m:
        return {"kind": "level", "level": int(m.group(1))}
    parts = [p.strip() for p in raw.split(MIDDOT)]
    lv = re.search(r"(\d+)", strip_md(parts[1])) if len(parts) > 1 else None
    return {"kind": "apotheosis", "minLevel": int(lv.group(1)) if lv else None,
            "event": strip_md(MIDDOT.join(parts[2:])) if len(parts) > 2 else None}


def parse_creature_sheets(techniques):
    lines = CREATURES.read_text(encoding="utf-8").splitlines()
    tech_ids = {t["id"] for t in techniques}
    signatures = {}
    for t in techniques:
        if t["species"]:
            signatures.setdefault(t["species"]["number"], []).append(t["id"])
    species, problems = [], []
    cur, section = None, None

    def tech(name, n):
        tid = slug(name)
        if tid not in tech_ids:
            problems.append("linea %d: tecnica desconocida '%s'" % (n, name))
        return tid

    for n, line in enumerate(lines, 1):
        line = line.rstrip()
        h = re.match(r"^## (\d+)\. (.+)$", line)
        if h:
            cur = {"id": slug(h.group(2)), "number": int(h.group(1)), "name": h.group(2).strip(),
                   "source": {"id": "CANON-CREATURES", "line": n}, "types": None, "powerCategory": None,
                   "rarity": None, "transfiguration": None, "apotheosis": None, "previousForm": None,
                   "nextForm": None, "transfigurationLine": None, "depthFactor": None, "baseStatsNV50": {},
                   "learnset": [], "onTransfigure": [], "training": [],
                   "signatureTechniques": signatures.get(int(h.group(1)), [])}
            species.append(cur)
            section = None
            continue
        if cur is None:
            continue
        f = re.match(r"^\*\*([^*]+):\*\*\s*(.*?)\s*$", line)
        if f:
            label, value = norm(f.group(1)), f.group(2)
            if label == "tipo":
                cur["types"] = [type_id(x) for x in value.split("/")]
                if not all(cur["types"]):
                    problems.append("linea %d: tipo desconocido '%s'" % (n, value))
            elif label == "categoria de poder":
                cur["powerCategory"] = slug(value)
            elif label == "rareza":
                cur["rarity"] = slug(value)
            elif label == "transfiguracion":
                cur["transfiguration"] = parse_transfiguration(value)
            elif label == "apoteosis":
                cur["apotheosis"] = strip_md(value)
            continue
        s = re.match(r"^\|\s*([^|]+?)\s*\|\s*([\d.,]+)\s*\|\s*$", line)
        if s and norm(s.group(1)) in SHEET_STATS:
            cur["baseStatsNV50"][SHEET_STATS[norm(s.group(1))]] = num(s.group(2))
            continue
        if line.startswith("#### "):
            section = norm(line[5:])
            continue
        if line.startswith("---") or line.startswith("### "):
            section = None
            continue
        item = re.match(r"^- (.+?)\s*$", line)
        if not item or section is None:
            continue
        text = item.group(1)
        exclusive = "(exclusiva)" in text
        text = text.replace("(exclusiva)", "").strip()
        if section == "aprende por nivel":
            lv = re.match(r"^Nivel (\d+): (.+)$", text)
            if lv:
                cur["learnset"].append({"level": int(lv.group(1)), "technique": tech(lv.group(2), n), "exclusive": exclusive})
            elif norm(text).startswith("al transfigurarse:"):
                cur["onTransfigure"].append(tech(text.split(":", 1)[1], n))
            else:
                problems.append("linea %d: entrada de nivel no reconocida '%s'" % (n, text))
        elif section == "aprende por entrenamiento":
            cur["training"].append(tech(text, n))

    # Una forma con Transfiguracion continua en la ficha siguiente de la guia
    for i, sp in enumerate(species):
        if sp["transfiguration"] and i + 1 < len(species):
            sp["nextForm"] = species[i + 1]["id"]
            species[i + 1]["previousForm"] = sp["id"]
    by_id = {sp["id"]: sp for sp in species}
    for sp in species:
        first = sp
        while first["previousForm"]:
            first = by_id[first["previousForm"]]
        sp["transfigurationLine"] = first["id"]
        if len(sp["baseStatsNV50"]) != len(SHEET_STATS):
            problems.append("%s: estadisticas NV50 incompletas" % sp["id"])
    known = {sp["number"] for sp in species}
    for number in signatures:
        if number not in known:
            problems.append("especie n.%d con tecnica especial pero sin ficha" % number)
    if problems:
        raise ValueError("Fichas de criaturas:\n  " + "\n  ".join(problems))
    return {
        "_meta": {
            "generatedFrom": "NarrativeEngine/" + CREATURES.name,
            "source": "CANON-CREATURES",
            "count": len(species),
            "statKeys": ["hp", "atk", "matk", "def", "mdef", "spe"],
            "note": "baseStatsNV50 a NV 50; Stat(NV) = Stat(NV50) x (0,50 + NV/200) / 0,75. "
                    "nextForm/previousForm se deducen del orden de la guia (la forma con Transfiguracion continua en la siguiente ficha).",
            "depthFactors": {"fluida": 0.8, "normal": 1.0, "exigente": 1.2, "dificil": 1.5, "singular": 2.0},
        },
        "species": species,
    }


# ------------------------------------------------------------------- main

def write(name, payload):
    (DATA / name).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    lines = SYSTEM.read_text(encoding="utf-8").splitlines()
    mech_off, mech_lines = source_block(lines, "CANON-MECHANICS")
    tech_off, tech_lines = source_block(lines, "CANON-TECHNIQUES")
    man_off, man_lines = source_block(lines, "CANON-MANIFESTATIONS")

    techniques = parse_techniques(tech_lines, tech_off)
    manifestations = parse_manifestations(man_lines, man_off)
    for label, items in (("tecnicas", techniques), ("manifestaciones", manifestations)):
        ids = [x["id"] for x in items]
        dupes = {x for x in ids if ids.count(x) > 1}
        if dupes:
            raise ValueError("IDs duplicados en %s: %s" % (label, dupes))

    DATA.mkdir(exist_ok=True)
    meta = {"generatedFrom": "NarrativeEngine/05_SISTEMA_DE_INVOCACION.md", "revision": "r2"}
    write("techniques.json", {"_meta": dict(meta, source="CANON-TECHNIQUES", count=len(techniques),
                                            note="description es autoritativo; mechanics es extraccion asistida"),
                              "techniques": techniques})
    write("manifestations.json", {"_meta": dict(meta, source="CANON-MANIFESTATIONS", count=len(manifestations),
                                                note="text es autoritativo; mechanics es extraccion asistida"),
                                  "manifestations": manifestations})
    write("types.json", dict({"_meta": meta}, **parse_type_chart(mech_lines, mech_off)))
    write("status_conditions.json", {"_meta": meta, "rules": STATUS_RULES, "conditions": STATUS_CONDITIONS})
    creatures = parse_creature_sheets(techniques)
    write("creatures.json", creatures)

    print("tecnicas:", len(techniques))
    print("manifestaciones:", len(manifestations))
    print("especies:", len(creatures["species"]), "lineas:",
          len({s["transfigurationLine"] for s in creatures["species"]}))


if __name__ == "__main__":
    main()
