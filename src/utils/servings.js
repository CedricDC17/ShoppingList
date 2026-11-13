// src/utils/servings.js
// Mise à l'échelle des quantités d'une recette selon le nombre de personnes.

const LEADING = /^(\d+(?:\s+\d+\/\d+|[.,/]\d+)?)(?:\s*(-|–|à|to)\s*(\d+(?:[.,/]\d+)?))?(.*)$/i
const METRIC = /^\s*(?:k?g|gr|grammes?|kilos?|kilogrammes?|mg|ml|cl|dl|l|litres?|centilitres?|millilitres?)\b\.?/i
const QUARTERS = ['', '¼', '½', '¾']

/** "1,5" -> 1.5, "1/2" -> 0.5, "2 1/4" -> 2.25 */
function toNumber(text) {
  const t = text.trim()
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  const frac = t.match(/^(\d+)\/(\d+)$/)
  if (frac) return Number(frac[1]) / Number(frac[2])
  return parseFloat(t.replace(',', '.'))
}

function decimal(n) {
  return String(n).replace('.', ',')
}

/**
 * Arrondi lisible :
 * - poids et volumes : 267 g -> 265 g, 13,3 g -> 13 g, 2,67 cl -> 2,7 cl
 * - pièces et mesures de cuisine : au quart près en dessous de 3 (1 ½ citron,
 *   ¾ c. à café), à l'unité au-delà (5 oeufs plutôt que 5,33)
 */
function formatAmount(n, metric) {
  if (metric) {
    if (n >= 100) return decimal(Math.round(n / 5) * 5)
    if (n >= 10) return decimal(Math.round(n))
    return decimal(Math.round(n * 10) / 10 || 0.1)
  }
  if (n >= 3) return decimal(Math.round(n))
  const quarters = Math.max(1, Math.round(n * 4))
  const whole = Math.floor(quarters / 4)
  const frac = QUARTERS[quarters % 4]
  if (!whole) return frac
  return frac ? `${whole} ${frac}` : String(whole)
}

/** 1500 g -> 1,5 kg ; 1200 ml -> 1,2 L */
function promote(n, unit) {
  const u = unit.trim().toLowerCase()
  if (n >= 1000 && /^(g|gr|grammes?)$/.test(u)) return [n / 1000, ' kg']
  if (n >= 1000 && /^(ml|millilitres?)$/.test(u)) return [n / 1000, ' L']
  return [n, unit]
}

/**
 * Adapte une quantité de recette à un autre nombre de personnes.
 *   scaleQuantity('200 g', 1.5)        -> '300 g'
 *   scaleQuantity('3', 4 / 3)          -> '4'
 *   scaleQuantity('1/2 c. à café', 2)  -> '1 c. à café'
 *   scaleQuantity('2 à 3', 2)          -> '4 à 6'
 *   scaleQuantity('une pincée', 2)     -> 'une pincée' (rien à calculer)
 */
export function scaleQuantity(quantity, factor) {
  const text = String(quantity || '').trim()
  if (!text || !factor || factor === 1) return text
  const m = text.match(LEADING)
  if (!m) return text

  const [, first, sep, second, rest] = m
  const metric = METRIC.test(rest)
  const a = toNumber(first) * factor
  if (!isFinite(a)) return text

  if (second) {
    const b = toNumber(second) * factor
    return `${formatAmount(a, metric)} ${sep} ${formatAmount(b, metric)}${rest}`
  }
  if (metric) {
    const unit = rest.match(METRIC)[0]
    const [value, newUnit] = promote(a, unit)
    const spaced = newUnit.startsWith(' ') ? newUnit : unit
    return `${formatAmount(value, true)}${spaced}${rest.slice(unit.length)}`
  }
  return `${formatAmount(a, false)}${rest}`
}
