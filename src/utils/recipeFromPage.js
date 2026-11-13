// src/utils/recipeFromPage.js
//
// Import d'une recette depuis la page d'un site (Marmiton, 750g, Ricardo…).
//
// Ces sites décrivent leurs recettes pour les moteurs de recherche dans un bloc
// <script type="application/ld+json"> au format schema.org/Recipe : titre,
// portions, ingrédients, étapes, temps. On le lit et on le remet dans le format
// texte de l'appli, que relit ensuite parseRecipeText() : un lien suit donc le
// même chemin qu'une recette collée, avec le même aperçu avant d'enregistrer.
//
// Utilisé côté serveur par api/import.js (le navigateur n'a pas le droit de
// lire la page d'un autre site). Imports avec extension .js pour Node.

import { ALL_TAGS } from './tags.js'

const LD_JSON = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi

/* ================================ Texte brut ================================ */

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»',
  hellip: '…', ndash: '–', mdash: '—', deg: '°', middot: '·', bull: '•', times: '×',
  frac12: '½', frac14: '¼', frac34: '¾', euro: '€',
  oelig: 'œ', OElig: 'Œ', aelig: 'æ', AElig: 'Æ', szlig: 'ß',
}
// &eacute; &Agrave; &ccedil;… : lettre + accent combinant, recomposés
const ACCENTS = {
  acute: '́', grave: '̀', circ: '̂', uml: '̈',
  cedil: '̧', tilde: '̃', ring: '̊',
}

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (whole, code) => {
    if (code[0] === '#') {
      const hex = code[1] === 'x' || code[1] === 'X'
      const n = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10)
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole
    }
    if (code in NAMED_ENTITIES) return NAMED_ENTITIES[code]
    const accent = code.match(/^([a-z])(acute|grave|circ|uml|cedil|tilde|ring)$/i)
    if (accent) return (accent[1] + ACCENTS[accent[2]]).normalize('NFC')
    return whole
  })
}

/**
 * Valeur JSON-LD -> lignes de texte propres. Les sites y laissent parfois du
 * HTML ou des entités encodées deux fois (« &amp;eacute; »).
 */
function textLines(value) {
  if (value == null || typeof value === 'object') return []
  let text = String(value)
  for (let i = 0; i < 2 && /&[#a-z0-9]+;/i.test(text); i++) text = decodeEntities(text)
  return text
    .replace(/<br\s*\/?>|<\/(?:p|li|div|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

const oneLine = value => textLines(value).join(' ')
const asList = value => (value == null ? [] : [].concat(value))

/**
 * Les sites canadiens doublent les mesures : "150 ml (2/3 tasse) de miel".
 * On garde la mesure métrique, sinon "(2/3 tasse) de" finirait dans le nom.
 */
function ingredientLine(value) {
  return oneLine(value).replace(/^([\d.,/ ½¼¾⅓⅔]+\s*(?:ml|cl|dl|l|g|kg)\.?)\s*\([^)]*\)/i, '$1')
}

/* ============================ Bloc JSON-LD Recipe ============================ */

/** Certains sites laissent des retours à la ligne bruts dans les chaînes JSON. */
function parseJson(raw) {
  const text = raw.trim()
  try {
    return JSON.parse(text)
  } catch {
    try {
      return JSON.parse(text.replace(/[\n\r\t]+/g, ' '))
    } catch {
      return null
    }
  }
}

/** "Recipe", ["Recipe", "NewsArticle"], "http://schema.org/Recipe"… */
function hasType(node, type) {
  const re = new RegExp(`(?:^|[/#:])${type}$`)
  return asList(node?.['@type']).some(t => re.test(String(t)))
}

/** La recette peut être au premier niveau, dans un tableau, un @graph… */
function findRecipe(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null
  if (!Array.isArray(node) && hasType(node, 'Recipe')) return node
  for (const child of Object.values(node)) {
    const found = findRecipe(child, depth + 1)
    if (found) return found
  }
  return null
}

/** Le bloc schema.org/Recipe d'une page HTML, ou null. */
export function findRecipeData(html) {
  for (const [, raw] of String(html || '').matchAll(LD_JSON)) {
    const recipe = findRecipe(parseJson(raw))
    if (recipe) return recipe
  }
  return null
}

/* ============================= Champs de la recette ============================= */

/** "Soupe au potiron : la meilleure recette" -> "Soupe au potiron" */
function cleanTitle(name) {
  return oneLine(name).replace(/\s*[:–—-]\s*(?:la|notre)\s+(?:meilleure|vraie)\s+recette\b.*$/i, '')
}

/** Durée ISO 8601 ("PT1H30M", "P0DT0H20M", "PT90M") -> minutes, 0 si illisible. */
function minutes(iso) {
  const m = String(iso || '').trim()
    .match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:[\d.]+S)?)?$/i)
  if (!m) return 0
  return (Number(m[1]) || 0) * 1440 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0)
}

/** 90 -> "1 h 30", 45 -> "45 min" */
function formatMinutes(total) {
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

/** Lignes « Préparation : 40 min », lues par parseRecipeText() comme des temps. */
function timeLines(recipe) {
  const prep = minutes(recipe.prepTime)
  const cook = minutes(recipe.cookTime)
  const total = minutes(recipe.totalTime)
  const lines = []
  if (prep) lines.push(`Préparation : ${formatMinutes(prep)}`)
  if (cook) lines.push(`Cuisson : ${formatMinutes(cook)}`)
  // Le temps total n'apporte quelque chose que s'il compte aussi un repos
  if (total > prep + cook) lines.push(`Temps total : ${formatMinutes(total)}`)
  return { lines, total: Math.max(total, prep + cook) }
}

const PEOPLE = /personne|pers\b|portion|part\b|parts\b|couvert|serving|serves|people/i

/**
 * "6 personnes", 4, ["8", "8 parts"] -> ligne « Pour N personnes ».
 * Un rendement d'une autre nature (« 1 bûche », « 24 cookies ») va dans les notes.
 */
function yieldInfo(recipeYield) {
  const values = asList(recipeYield).map(oneLine).filter(v => /\d/.test(v))
  const people = values.find(v => /^\d+$/.test(v) || PEOPLE.test(v))
  const n = parseInt(people?.match(/\d+/)?.[0], 10)
  if (n > 0 && n < 100) return { servings: `Pour ${n} personnes` }
  return values[0] ? { note: `Quantité : ${values[0]}` } : {}
}

/**
 * Étapes à plat. Les sections (HowToSection) deviennent des intertitres
 * « Nom : », comme une recette en plusieurs parties collée à la main.
 * Le titre d'une étape (HowToStep.name) est ignoré : il reprend souvent le
 * début du texte, et « Préparation du chocolat » serait lu comme une partie.
 */
function stepLines(value, depth = 0) {
  if (value == null || depth > 6) return []
  if (Array.isArray(value)) return value.flatMap(v => stepLines(v, depth + 1))
  if (typeof value !== 'object') return textLines(value)

  const children = value.itemListElement ?? value.steps
  if (children) {
    const inner = stepLines(children, depth + 1)
    const name = oneLine(value.name).replace(/\s*:$/, '')
    return hasType(value, 'HowToSection') && name && inner.length ? [`${name} :`, ...inner] : inner
  }
  return textLines(value.text ?? value.description ?? value.name)
}

// Catégories des sites -> tags de l'appli (seuls ceux de ALL_TAGS sont gardés)
const CATEGORY_TAGS = [
  [/dessert/i, 'Dessert'],
  [/g[âa]teau|cake/i, 'Gâteau'],
  [/\bplats?\b|\bmain\b/i, 'Plat'],
  [/entr[ée]e|starter|appetizer/i, 'Entrée'],
  [/accompagnement|\bside\b/i, 'Accompagnement'],
  [/sauce/i, 'Sauce'],
  [/ap[ée]ritif|amuse|ap[ée]ro/i, 'Apéro'],
  [/petit[- ]d[ée]jeuner|breakfast|brunch/i, 'Matin'],
  [/d[îi]ner|dinner|supper/i, 'Soir'],
  [/v[ée]g[ée]tarien|vegetarian|vegan/i, 'Végé'],
]

function tagsFor(recipe, totalMinutes) {
  const categories = asList(recipe.recipeCategory).map(oneLine).join(' ')
  const tags = CATEGORY_TAGS.filter(([re]) => re.test(categories)).map(([, tag]) => tag)
  if (totalMinutes > 0 && totalMinutes <= 30) tags.push('Rapide')
  if (asList(recipe.suitableForDiet).some(d => /vegetarian|vegan/i.test(String(d)))) tags.push('Végé')
  return [...new Set(tags)].filter(tag => ALL_TAGS.includes(tag))
}

/** Lien gardé dans les notes, sans les paramètres de suivi. */
function cleanLink(url) {
  try {
    const link = new URL(url)
    for (const key of [...link.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_)/i.test(key)) link.searchParams.delete(key)
    }
    link.hash = ''
    return link.href
  } catch {
    return ''
  }
}

/* ================================== Export ================================== */

/**
 * Bloc schema.org/Recipe -> texte au format de l'appli (voir recipeToText),
 * ou null s'il n'y a ni ingrédient ni étape.
 */
export function recipeDataToText(recipe, url = '') {
  const ingredients = asList(recipe.recipeIngredient ?? recipe.ingredients).map(ingredientLine).filter(Boolean)
  const steps = stepLines(recipe.recipeInstructions)
  if (!ingredients.length && !steps.length) return null

  const times = timeLines(recipe)
  const { servings, note } = yieldInfo(recipe.recipeYield)
  const tags = tagsFor(recipe, times.total)
  const link = cleanLink(url)
  const notes = [note, link && `Lien : ${link}`].filter(Boolean)

  return [
    [cleanTitle(recipe.name) || 'Recette importée', servings, ...times.lines].filter(Boolean).join('\n'),
    ingredients.length && `Ingrédients :\n${ingredients.join('\n')}`,
    steps.length && `Préparation :\n${steps.join('\n')}`,
    [tags.length && `Tags : ${tags.join(', ')}`, notes.length && `Notes :\n${notes.join('\n')}`]
      .filter(Boolean).join('\n'),
  ].filter(Boolean).join('\n\n')
}

/**
 * Lien à importer dans le texte de création : un lien seul, ou entouré de
 * quelques mots comme le partage depuis une appli (« Découvre cette recette :
 * https://… »). Une recette complète collée n'en est pas un.
 * @returns le lien, ou null
 */
export function findRecipeLink(text) {
  const t = String(text || '').trim()
  if (!t || t.length > 400 || t.split('\n').length > 3) return null
  const m = t.match(/\b(?:https?:\/\/|www\.)[^\s<>"«»]+/i)
  if (!m) return null
  const link = m[0].replace(/[),.;:!?»"']+$/, '')
  return /^www\./i.test(link) ? `https://${link}` : link
}

/** Page HTML -> texte de la recette, ou null si la page n'en décrit pas. */
export function recipeFromPage(html, url = '') {
  const recipe = findRecipeData(html)
  return recipe ? recipeDataToText(recipe, url) : null
}
