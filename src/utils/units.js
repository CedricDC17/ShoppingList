// src/utils/units.js
import { matchKey, toDisplayName } from './normalize.js'

// Unités optionnelles. Aucune unité par défaut : si elle est choisie, elle
// s'affiche simplement en plus de la quantité.

export const UNITS = ['unité', 'boîte', 'paquet', 'sachet', 'bouteille', 'g', 'kg', 'ml', 'cl', 'L']

/**
 * Badge affiché à côté du nom d'un article.
 * - quantité seule > 1        -> "×2"
 * - quantité + unité          -> "×500 g"
 * - rien à signaler           -> null
 */
export function formatQuantity(quantity, unit) {
  const qty = Number(quantity)
  if (!qty || qty < 1) return null
  if (unit) return `×${qty} ${unit}`
  if (qty > 1) return `×${qty}`
  return null
}

// Unités de recette qui ont un sens pour faire les courses.
const SHOPPING_UNITS = {
  g: 'g', gr: 'g', gramme: 'g', grammes: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogramme: 'kg', kilogrammes: 'kg',
  ml: 'ml', millilitre: 'ml', millilitres: 'ml',
  cl: 'cl', centilitre: 'cl', centilitres: 'cl',
  l: 'L', litre: 'L', litres: 'L',
  boite: 'boîte', boites: 'boîte', boîte: 'boîte', boîtes: 'boîte',
  paquet: 'paquet', paquets: 'paquet',
  sachet: 'sachet', sachets: 'sachet',
  bouteille: 'bouteille', bouteilles: 'bouteille',
  unite: 'unité', unites: 'unité', unité: 'unité', unités: 'unité',
  piece: 'unité', pieces: 'unité', pièce: 'unité', pièces: 'unité',
}

/**
 * Convertit une quantité de recette (texte libre) vers le couple
 * quantité/unité de la liste de courses.
 *
 *   "200 g"        -> { quantity: 200, unit: 'g' }
 *   "1,5 kg"       -> { quantity: 1.5, unit: 'kg' }
 *   "4"            -> { quantity: 4, unit: null }
 *   "2 c. à soupe" -> { quantity: null, unit: null }   (mesure de cuisine :
 *                      on achète un pot d'huile, pas deux cuillères)
 *   "1/2"          -> { quantity: null, unit: null }   (on n'achète pas un demi)
 */
export function parseQuantityForShopping(raw) {
  const empty = { quantity: null, unit: null }
  const text = String(raw || '').trim().toLowerCase()
  if (!text) return empty

  // fractions : on ne les reporte pas sur une liste de courses
  if (/^\d+\s*\/\s*\d+/.test(text)) return empty

  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/)
  if (!match) return empty

  const quantity = parseFloat(match[1].replace(',', '.'))
  if (!quantity || quantity <= 0) return empty

  const rest = match[2]
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!rest) return { quantity, unit: null }

  const unit = SHOPPING_UNITS[rest.split(' ')[0]] || SHOPPING_UNITS[rest]
  if (unit) return { quantity, unit }

  // Mesure de cuisine (cuillère, pincée, gousse, tranche…) : le nombre n'aide
  // pas à acheter, on ajoute simplement le produit.
  return empty
}

// Unités convertibles entre elles : [unité de base, facteur]
const BASE = { g: ['g', 1], kg: ['g', 1000], ml: ['ml', 1], cl: ['ml', 10], L: ['ml', 1000] }

const round = n => Math.round(n * 100) / 100

function addQuantities(a, b) {
  if (!b.quantity) return a
  if (!a.quantity) return b
  if (a.unit === b.unit) return { quantity: round(a.quantity + b.quantity), unit: a.unit }
  const [baseA, fa] = BASE[a.unit] || []
  const [baseB, fb] = BASE[b.unit] || []
  if (baseA && baseA === baseB) {
    const total = a.quantity * fa + b.quantity * fb
    if (total >= 1000) return { quantity: round(total / 1000), unit: baseA === 'g' ? 'kg' : 'L' }
    return { quantity: round(total), unit: baseA }
  }
  return a // unités incompatibles (2 paquets + 200 g) : on garde la première
}

/**
 * Prépare des ingrédients de recette pour la liste de courses : quantités
 * converties, et un même produit présent dans plusieurs parties additionné
 * (100 g de beurre pour la pâte + 50 g pour la crème -> 150 g).
 * @returns [{ name, quantity, unit }]
 */
export function mergeForShopping(ingredients) {
  const merged = new Map()
  for (const ing of ingredients) {
    const name = toDisplayName(ing.name)
    if (!name) continue
    const qty = parseQuantityForShopping(ing.quantity)
    const key = matchKey(name)
    const prev = merged.get(key)
    merged.set(key, prev ? { name: prev.name, ...addQuantities(prev, qty) } : { name, ...qty })
  }
  return [...merged.values()]
}
