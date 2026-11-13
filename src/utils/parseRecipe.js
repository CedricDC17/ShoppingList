// src/utils/parseRecipe.js
//
// Analyse un texte de recette collé, quel qu'en soit le format.
//
// Toute l'appli passe par parseRecipeText(). La mise en forme par IA
// (src/utils/ai.js) renvoie du texte dans le format canonique de recipeToText(),
// que ce même parseur relit : il n'existe qu'un seul chemin d'import.
//
// Recettes en plusieurs parties (pâte, crème…) : les listes d'ingrédients et
// d'étapes peuvent contenir des intertitres { section: 'Pâte' } au milieu des
// éléments ordinaires. Une recette sans partie n'en contient aucun, ce qui
// garde les anciennes fiches valides telles quelles.

import { ALL_TAGS } from './tags.js'
import { normalizeName } from './normalize.js'

/* ================================ Intertitres ================================ */

/** L'élément est-il un intertitre de partie (et non un ingrédient ou une étape) ? */
export function isSection(entry) {
  return Boolean(entry && typeof entry === 'object' && entry.section)
}

/** Retire les intertitres sans contenu (suivis d'un autre intertitre ou de rien). */
function pruneSections(list) {
  return list.filter((entry, i) => !isSection(entry) || (list[i + 1] && !isSection(list[i + 1])))
}

/* ============================ Nettoyage d'une ligne ============================ */

const BULLET = /^[-–—•*·+>◦▪→⇒➔➜●○■□◆◇]\s*/
const ORDINAL = /^\(?\d+\s*[.)°/:]\s+/
const STEP_PREFIX = /^(?:[ée]tape|step)\s*(?:n°\s*)?\d+\s*[:.)\-–—/]?\s*/i

// Chiffres en émoji (1️⃣ 2️⃣) : on les convertit en numérotation ordinaire.
const KEYCAPS = /((?:[0-9]\uFE0F?\u20E3)+)\s*/gu
// Pictogrammes, drapeaux, teintes de peau, sélecteurs de variante, liaisons.
const EMOJI = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|[\u{1F3FB}-\u{1F3FF}]|\uFE0E|\uFE0F|\u200D|\u20E3/gu
const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu
const MENTION = /(^|\s)@[\w.]+/g

const UNICODE_FRACTIONS = { '½': [1, 2], '¼': [1, 4], '¾': [3, 4], '⅓': [1, 3], '⅔': [2, 3], '⅛': [1, 8] }

// Lignes de remplissage des recettes de réseaux sociaux, testées sans accents.
const JUNK = [
  /^bon(ne)? app?etit\b/, /^enjoy\b/, /^regalez[- ]vous/, /^a vos (fourneaux|tabliers)/,
  /abonne[- ]?toi|abonnez[- ]?vous|follow (me|us|for)|lien en bio|link in bio/,
  /en commentaires?|in the comments|dis[- ]moi|dites[- ]moi|tell me/,
  /(enregistre|sauvegarde|partage)[rz]? (cette|la|ce|ma) (recette|post|publication|video)/,
  /save (this|it|for later)|share (this|with)/,
  /identifie|tag (un|une|a|your) (ami|amie|pote|friend)/,
  /^(recette )?(par|by|credits?|source)\s*:/,
  /^(swipe|glisse)\b|^lire la suite/,
  /n'?oublie[sz]? pas de/,
]

function expandFractions(line) {
  return line
    .replace(/\u2044/g, '/')
    .replace(/(\d+)?\s?([½¼¾⅓⅔⅛])/g, (_, whole, frac) => {
      const [n, d] = UNICODE_FRACTIONS[frac]
      if (!whole) return `${n}/${d}`
      return String(Math.round((Number(whole) + n / d) * 100) / 100).replace('.', ',')
    })
}

/** Retire puces et numérotation en début de ligne. */
function stripLead(line) {
  return line.replace(BULLET, '').replace(ORDINAL, '').trim()
}

/**
 * Nettoie une ligne brute : émojis, hashtags, mentions, puces, numérotation,
 * préfixes « Étape 1 : ». Renvoie '' pour une ligne à ignorer.
 * Une ligne entièrement en gras ou en titre markdown devient « Nom : » pour
 * être reconnue comme intertitre.
 */
function cleanLine(raw) {
  let line = String(raw || '')
    .replace(KEYCAPS, (_, keys) => keys.replace(/[\uFE0F\u20E3]/g, '') + '. ')
    .replace(EMOJI, ' ')
    .replace(HASHTAG, '$1')
    .replace(MENTION, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  line = expandFractions(line)

  // Titres markdown et lignes en gras : "## Pâte", "**Pâte**", "__Pâte__"
  const heading = line.match(/^#{1,4}\s+(.+)$/) || line.match(/^(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?$/)
  if (heading) line = heading[1].replace(/\s*:$/, '') + ' :'
  line = line.replace(/\*\*|__/g, '')

  line = stripLead(line).replace(STEP_PREFIX, '').replace(/([!?])\1+/g, '$1').trim()

  if (!/\p{L}/u.test(line)) return '' // plus aucune lettre : séparateur, décoration
  if (line.length < 150 && JUNK.some(re => re.test(normalizeName(line)))) return ''
  return line
}

function splitLines(text) {
  return String(text || '').split(/\r?\n/)
}

/** "TARTE AU CITRON" -> "Tarte au citron" ; première lettre en majuscule. */
function tidyCase(text) {
  let t = text.trim()
  if (t === t.toUpperCase() && /\p{Lu}{2}/u.test(t)) t = t.toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/* ============================== Sections & parties ============================== */

const SECTION_WORDS = {
  ingredients:
    "ingr[ée]dients?|il (?:te|vous) faut|ce qu['’]il (?:te|vous) faut|liste des courses|what you(?:['’]ll)? need|you(?:['’]ll)? need",
  steps:
    '[ée]tapes?|pr[ée]parations?|instructions?|m[ée]thodes?|r[ée]alisations?|d[ée]roulement|recette|directions?|method|steps?|how to make(?: it)?',
  notes:
    'notes?|remarques?|astuces?|conseils?|infos?|tips?|variantes?|conservation',
}

const SECTION_RES = Object.entries(SECTION_WORDS).map(([kind, words]) => ({
  kind,
  re: new RegExp(
    `^(?:les |the )?(${words})(?:\\s+(?:pour|de|du|des|d['’]|for|of)\\s*(.+?))?\\s*(?::\\s*(.*))?$`,
    'i'
  ),
}))

/**
 * En-tête de section principale : "Ingrédients :", "Préparation de la pâte :",
 * "Notes : à conserver au frais"…
 * @returns {{kind, part, rest}|null}
 */
function matchSection(line) {
  for (const { kind, re } of SECTION_RES) {
    const m = line.match(re)
    if (!m) continue
    const part = m[2] && isShortLabel(m[2]) ? cleanPartName(m[2]) : null
    if (m[2] && !part) continue // "Préparation de 15 minutes…" : pas un en-tête
    // "Recette de la pâte :" annonce une partie, pas la section des étapes
    if (/^recette$/i.test(m[1]) && part) return { kind: null, part, rest: m[3] || '' }
    return { kind, part, rest: (m[3] || '').trim() }
  }
  return null
}

// Phrases de transition qui finissent parfois par « : » sans être des parties
const TRANSITIONS =
  /^(pendant ce temps|ensuite|puis|enfin|apr[eè]s [çc]a|meanwhile|then|finally|pour finir|pour terminer|et voil[aà]|voil[aà])\b/i

function isShortLabel(text) {
  const t = text.trim()
  return (
    t.length >= 2 &&
    t.length <= 40 &&
    !/\d/.test(t) &&
    !/[,.;!?]/.test(t) &&
    t.split(/\s+/).length <= 6 &&
    !TRANSITIONS.test(t)
  )
}

// Un article en toutes lettres est suivi d'une espace ; seule l'élision (l', de l') colle au mot.
const ARTICLE = /^(?:(?:la|le|les|the|un|une|a|des|du|de la)\s+|(?:de )?l['’]\s*)/i

/** "Pour la pâte" -> "Pâte", "LA CRÈME" -> "Crème", "For the dough" -> "Dough" */
function cleanPartName(text) {
  let t = tidyCase(text.replace(/\s*:$/, '').trim())
  t = t.replace(/^(?:pour|for)\s+/i, '')
  t = t.replace(ARTICLE, '')
  return tidyCase(t)
}

/**
 * Intertitre de partie : "Pour la pâte :", "Crème :", "Recette 2 : la crème",
 * "Pour le glaçage" (sans deux-points).
 * @returns le nom de la partie, ou null
 */
function matchPartHeader(line) {
  const numbered = line.match(/^(?:recette|partie|part)\s*(?:n°\s*)?\d+\s*[:.\-–—)]\s*(.+)$/i)
  if (numbered && isShortLabel(numbered[1].replace(/\s*:$/, ''))) return cleanPartName(numbered[1])

  if (/:$/.test(line) && isShortLabel(line.slice(0, -1))) return cleanPartName(line)

  if (/^(?:pour|for)\s+(?:(?:la|le|les|the|un|une|a)\s+|l['’])\S/i.test(line) && isShortLabel(line)) {
    return cleanPartName(line)
  }
  return null
}

/* ============================ Portions, temps, tags ============================ */

const SERVINGS =
  /^(?:pour\s+)?(?:environ\s+)?\d+(?:\s*(?:à|-|–)\s*\d+)?\s*(?:personnes?|pers\b\.?|parts?|portions?|couverts?|gourmands?|servings?|people)\b/i
const SERVINGS_LABEL = /^(?:serves|servings|yield|makes|portions?|parts?|nombre de (?:parts|personnes))\s*:?\s*\d+/i
const SERVINGS_PAREN =
  /\s*\(([^)]*\d[^)]*(?:personnes?|pers\b|parts?|portions?|servings?|people|couverts?)[^)]*)\)/i

const TIME_LABEL =
  "(?:temps\\s+(?:de\\s+|d['’])?)?(?:pr[ée]paration|pr[ée]pa|cuisson|repos|r[ée]frig[ée]ration|attente|total)|(?:prep(?:aration)?|cook(?:ing)?|total|rest(?:ing)?|bake|baking)\\s+time"
const TIME_LINE = new RegExp(
  `^(?:${TIME_LABEL})\\s*(:)?\\s*(?:environ\\s+|~\\s*)?\\d+\\s*(?:h\\b|heures?|min|minutes?|mn|hours?|hrs?)`,
  'i'
)

/** "pour 4 à 6 personnes" -> 4 */
function servingsFrom(text) {
  const n = parseInt(String(text).match(/\d+/)?.[0], 10)
  return n > 0 && n < 100 ? n : null
}

/** Tags reconnus dans "Tags : Plat, Rapide" — seulement ceux de la liste fixe. */
function parseTags(text) {
  const wanted = text.split(/[,;·/]/).map(t => normalizeName(t))
  return ALL_TAGS.filter(tag => wanted.includes(normalizeName(tag)))
}

/* ================================= Ingrédients ================================= */

// Unités reconnues, des formes les plus longues aux plus courtes : l'ordre compte,
// "cuillères à soupe" doit être testé avant "cuillères".
const UNIT_WORDS = '(?:' + [
  // cuillères sous toutes leurs formes : "c. à s.", "c à café", "cuillère à soupe"…
  'c(?:uill?[eè]res?)?\\.?\\s*[àa]\\.?\\s*(?:soupe|caf[ée]|dessert|s|c|d)\\.?',
  'cuill?[eè]res?',
  'tablespoons?', 'teaspoons?', 'tbsps?\\.?', 'tsps?\\.?',
  // mesures approximatives courantes en cuisine
  'pinc[ée]es?', 'poign[ée]es?', 'noix', 'filets?', 'traits?', 'zestes?',
  'gousses?', 'brins?', 'branches?', 'feuilles?', 'tranches?', 'bottes?',
  'bo[iî]tes?', 'sachets?', 'paquets?', 'tasses?', 'verres?', 'pots?',
  'briques?', 'bouteilles?', 'tiges?', 'morceaux?', 'portions?',
  'pi[èe]ces?', 'unit[ée]s?', 'bocaux', 'bocal', 'rouleaux?',
  'pinch(?:es)?', 'handfuls?', 'dash(?:es)?', 'cloves?', 'sprigs?', 'bunch(?:es)?',
  'slices?', 'sticks?', 'cans?', 'cups?', 'ounces?', 'pounds?', 'lbs?', 'oz',
  // unités métriques : les plus longues d'abord
  'kilogrammes?', 'kilos?', 'grammes?', 'centilitres?', 'millilitres?', 'litres?',
  'kg', 'mg', 'ml', 'cl', 'dl', 'gr', 'g', 'l', 'cs', 'cc',
].join('|') + ')'

// Nombre, fraction, nombre mixte ou fourchette : "200", "1,5", "1/2", "2 1/4", "2-3", "2 à 3"
const NUMBER = '\\d+(?:\\s+\\d+/\\d+|[.,/]\\d+)?(?:\\s*(?:-|–|à|to)\\s*\\d+(?:[.,/]\\d+)?)?'

// Articles de liaison à retirer devant le nom ("200 g DE farine", "3 gousses D'ail").
// Gère l'apostrophe droite et l'apostrophe typographique.
const LINKING_ARTICLE = /^(?:de\s+la\s+|de\s+l['’]\s*|des\s+|du\s+|de\s+|d['’]\s*|of\s+(?:the\s+)?)/i

function tidyName(name) {
  return name.replace(/[\s,.;]+$/, '').trim()
}

/**
 * Découpe une ligne en quantité + nom, en acceptant les deux ordres.
 * "200 g de farine" -> { quantity: '200 g', name: 'farine' }
 * "farine 200g"     -> { quantity: '200g',  name: 'farine' }
 * "3 oeufs"         -> { quantity: '3',     name: 'oeufs' }
 * "sel"             -> { quantity: '',      name: 'sel' }
 */
export function parseIngredientLine(raw) {
  let line = stripLead(String(raw || '')).replace(/\s+/g, ' ').trim()
  if (!line) return null

  // "farine : 200 g" / "farine - 200 g"
  const splitMatch = line.match(/^(.+?)\s*[:–—-]\s*(\d[^:]*)$/)
  if (splitMatch && /\d/.test(splitMatch[2])) {
    return { quantity: splitMatch[2].trim(), name: tidyName(splitMatch[1]) }
  }

  // quantité en tête : "200 g de farine", "1/2 citron", "2 c. à soupe d'huile"
  const leading = line.match(new RegExp(`^(${NUMBER}\\s*${UNIT_WORDS}?)\\s+(.*)$`, 'i'))
  if (leading && leading[2]) {
    const name = tidyName(leading[2].replace(LINKING_ARTICLE, ''))
    if (name) return { quantity: leading[1].trim(), name }
  }

  // quantité entre parenthèses : "farine (200 g)"
  const paren = line.match(/^(.+?)\s*\((\d[^)]*)\)$/)
  if (paren) return { quantity: paren[2].trim(), name: tidyName(paren[1]) }

  // quantité en fin : "farine 200 g", "lait 50cl"
  const trailing = line.match(new RegExp(`^(.+?)\\s+(${NUMBER}\\s*${UNIT_WORDS})$`, 'i'))
  if (trailing) {
    return { quantity: trailing[2].trim(), name: tidyName(trailing[1]) }
  }

  return { quantity: '', name: tidyName(line) }
}

/** Une ligne qui contient plusieurs ingrédients séparés par · ou des virgules. */
function explodeIngredientLine(line) {
  if (line.includes('·')) return line.split('·')
  if (line.includes(';')) return line.split(';')
  // "farine, sucre, oeufs" : on ne découpe que si ça ressemble vraiment à une énumération
  const commas = (line.match(/,/g) || []).length
  if (commas >= 2 && line.length < 200) return line.split(',')
  return [line]
}

function ingredientsFromLine(line) {
  return explodeIngredientLine(line)
    .map(parseIngredientLine)
    .filter(ing => ing && ing.name)
}

/** Transforme un bloc de texte (une ligne par ingrédient, « Partie : » possible). */
export function parseIngredientsText(text) {
  const out = []
  for (const raw of splitLines(text)) {
    const line = cleanLine(raw)
    if (!line) continue
    const part = matchPartHeader(line)
    if (part) out.push({ section: part })
    else out.push(...ingredientsFromLine(line))
  }
  return pruneSections(out)
}

/**
 * "Pendant ce temps :" seul sur sa ligne est rattaché à l'étape suivante :
 * "Pendant ce temps, fouetter le beurre."
 */
function mergeTransitions(steps) {
  const out = []
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const next = steps[i + 1]
    if (typeof step === 'string' && /:$/.test(step) && TRANSITIONS.test(step) && typeof next === 'string') {
      out.push(`${step.replace(/\s*:$/, '')}, ${next.charAt(0).toLowerCase()}${next.slice(1)}`)
      i++
    } else {
      out.push(step)
    }
  }
  return out
}

/** Transforme un bloc de texte en liste d'étapes (« Partie : » possible). */
export function parseStepsText(text) {
  const out = []
  for (const raw of splitLines(text)) {
    const line = cleanLine(raw)
    if (!line) continue
    const part = matchPartHeader(line)
    out.push(part ? { section: part } : line)
  }
  return pruneSections(mergeTransitions(out))
}

/* ============================== Recette ⇄ texte ============================== */

/**
 * Écarte les ingrédients et les étapes vides ou faits d'espaces.
 * Certaines recettes déjà en base contiennent de telles lignes fantômes :
 * on les ignore à l'affichage, et l'enregistrement suivant les efface.
 */
export function cleanRecipe(recipe = {}) {
  const ingredients = (recipe.ingredients || [])
    .map(i => {
      if (isSection(i)) return { section: String(i.section).trim() }
      if (!i || !String(i.name || '').trim()) return null
      return { name: String(i.name).trim(), quantity: String(i.quantity || '').trim() }
    })
    .filter(Boolean)
  const steps = (recipe.steps || [])
    .map(s => {
      if (isSection(s)) return { section: String(s.section).trim() }
      if (s && typeof s === 'object') return null
      return String(s || '').trim() || null
    })
    .filter(Boolean)
  return {
    ...recipe,
    servings: servingsFrom(recipe.servings ?? ''),
    ingredients: pruneSections(ingredients),
    steps: pruneSections(steps),
    notes: String(recipe.notes || '').trim(),
  }
}

/**
 * Étape au format « Titre court : détail » -> { label, text }.
 * Sans titre reconnaissable, label est vide et text contient toute l'étape.
 */
export function splitStepLabel(step) {
  const m = String(step || '').match(/^([^:]{2,45}?)\s*:\s+(.+)$/)
  if (m && !/\d/.test(m[1]) && m[1].split(/\s+/).length <= 6) {
    return { label: m[1].trim(), text: m[2].trim() }
  }
  return { label: '', text: String(step || '') }
}

/** Nombre d'ingrédients réels, intertitres exclus. */
export function countIngredients(ingredients = []) {
  return ingredients.filter(i => !isSection(i)).length
}

/** Remet une liste d'ingrédients sous forme de texte éditable. */
export function ingredientsToText(ingredients = []) {
  return ingredients
    .map(i => (isSection(i) ? `${i.section} :` : [i.quantity, i.name].filter(Boolean).join(' ').trim()))
    .filter(Boolean)
    .join('\n')
}

/** Remet une liste d'étapes sous forme de texte éditable. */
export function stepsToText(steps = []) {
  return steps
    .map(s => (isSection(s) ? `${s.section} :` : String(s || '').trim()))
    .filter(Boolean)
    .join('\n')
}

/** Recette complète au format texte canonique, relisible par parseRecipeText(). */
export function recipeToText({
  title = '', servings = null, ingredients = [], steps = [], tags = [], notes = '',
} = {}) {
  const blocks = [[title.trim(), servings ? `Pour ${servings} personnes` : ''].filter(Boolean).join('\n')]
  if (ingredients.length) blocks.push(`Ingrédients :\n${ingredientsToText(ingredients)}`)
  if (steps.length) blocks.push(`Préparation :\n${stepsToText(steps)}`)
  const tail = []
  if (tags.length) tail.push(`Tags : ${tags.join(', ')}`)
  if (notes.trim()) tail.push(`Notes :\n${notes.trim()}`)
  if (tail.length) blocks.push(tail.join('\n'))
  return blocks.filter(Boolean).join('\n\n')
}

/* ============================== Analyse complète ============================== */

/** Une ligne ressemble-t-elle davantage à une étape qu'à un ingrédient ? */
function looksLikeStep(line) {
  const clean = stripLead(line)
  const words = clean.split(/\s+/).filter(Boolean).length

  // Une ligne qui commence par une quantité est un ingrédient, même si elle
  // contient des points d'abréviation ("2 c. à soupe de miel").
  if (/^\d/.test(clean) && words <= 12) return false

  if (clean.length > 70) return true
  // vraie ponctuation de phrase : point suivi d'une majuscule (et non "c. à s.")
  if (/[.!?]\s+[A-ZÀ-Þ]/.test(clean)) return true
  // phrase terminée par un point et assez longue pour ne pas être un ingrédient
  if (/[.!?]$/.test(clean) && words >= 6) return true
  return words > 12
}

/**
 * Ajoute les intertitres de partie devant le premier élément de chaque partie.
 * @param entries [{ text, part }]
 */
function withSections(entries, toItems) {
  const out = []
  let last = null
  for (const { text, part } of entries) {
    if (part && part !== last) out.push({ section: part })
    last = part
    out.push(...toItems(text))
  }
  return pruneSections(out)
}

/**
 * Analyse un texte de recette complet.
 * @returns {{title, servings, ingredients, steps, notes, tags, imageUrl}}
 */
export function parseRecipeText(text) {
  const recipe = {
    title: '', servings: null, ingredients: [], steps: [], notes: '', tags: [], imageUrl: '',
  }
  const lines = splitLines(text).map(cleanLine).filter(Boolean)
  if (!lines.length) return recipe

  const meta = [] // temps de préparation, de cuisson… regroupés en tête des notes

  // ---- Titre : première ligne, sauf si c'est déjà un en-tête de section
  if (!matchSection(lines[0])) {
    let first = lines.shift().replace(/^(?:recette|titre|title)\s*:\s*/i, '')
    const servings = first.match(SERVINGS_PAREN)
    if (servings) {
      recipe.servings = servingsFrom(servings[1])
      first = first.replace(SERVINGS_PAREN, '')
    }
    first = first
      .replace(/^(?:la\s+)?recette\s+(?:de\s+la|de\s+l['’]|des|du|de|d['’])\s*/i, '')
      .replace(/[\s:!]+$/, '')
    recipe.title = tidyCase(first)
  }

  // ---- Répartition des lignes entre sections, avec leur partie éventuelle
  const buckets = { ingredients: [], steps: [], notes: [] }
  const preamble = [] // lignes avant toute section
  let current = null
  let sawSection = false
  let part = null
  // Une partie annoncée juste avant un en-tête ("Recette 2 : crème" puis
  // "Ingrédients :") englobe les sections qui suivent ; une partie annoncée à
  // l'intérieur d'une section ("Pour la pâte :") s'arrête à la section suivante.
  let partEnclosesSections = false

  lines.forEach((rawLine, index) => {
    let line = rawLine

    if (current !== 'notes') {
      const servings = line.match(SERVINGS_PAREN)
      if (servings) {
        recipe.servings ??= servingsFrom(servings[1])
        line = line.replace(SERVINGS_PAREN, '').trim()
      }
      if (SERVINGS.test(line) || SERVINGS_LABEL.test(line)) {
        recipe.servings ??= servingsFrom(line)
        return
      }
      const time = line.match(TIME_LINE)
      if (time && (current !== 'steps' || time[1])) {
        meta.push(tidyCase(line))
        return
      }
    }

    const tags = line.match(/^tags?\s*:\s*(.+)$/i)
    if (tags) {
      recipe.tags = parseTags(tags[1])
      return
    }

    const section = matchSection(line)
    if (section) {
      if (!partEnclosesSections) part = null
      if (section.kind) {
        current = section.kind
        sawSection = true
      }
      if (section.part) {
        part = section.part
        partEnclosesSections = !section.kind
      }
      if (section.rest && current) buckets[current].push({ text: section.rest, part })
      return
    }

    const header = matchPartHeader(line)
    if (header) {
      part = header
      partEnclosesSections = Boolean(lines[index + 1] && matchSection(lines[index + 1])?.kind)
      return
    }

    if (current) buckets[current].push({ text: line, part })
    else preamble.push({ text: line, part })
  })

  if (sawSection) {
    // Avant le premier en-tête : des ingrédients si ça y ressemble, sinon du
    // texte d'introduction qu'on laisse de côté.
    buckets.ingredients.unshift(...preamble.filter(e => !looksLikeStep(e.text)))
  } else {
    // ---- Pas de section explicite : on devine où basculent les étapes
    let cut = preamble.findIndex(e => looksLikeStep(e.text))
    if (cut === -1) cut = preamble.length
    buckets.ingredients = preamble.slice(0, cut)
    buckets.steps = preamble.slice(cut)
  }

  recipe.ingredients = withSections(buckets.ingredients, ingredientsFromLine)
  recipe.steps = mergeTransitions(withSections(buckets.steps, line => [line]))

  // Une seule partie qui couvre toute la recette : l'intertitre n'apporte rien
  const parts = new Set([...recipe.ingredients, ...recipe.steps].filter(isSection).map(s => s.section))
  const firstIsSection = list => !list.length || isSection(list[0])
  if (parts.size === 1 && firstIsSection(recipe.ingredients) && firstIsSection(recipe.steps)) {
    recipe.ingredients = recipe.ingredients.filter(i => !isSection(i))
    recipe.steps = recipe.steps.filter(s => !isSection(s))
  }

  recipe.notes = [meta.join(' · '), ...buckets.notes.map(e => e.text)].filter(Boolean).join('\n')
  return recipe
}
