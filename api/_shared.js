// api/_shared.js — code commun aux fonctions de api/
// Le préfixe « _ » empêche Vercel d'en faire une fonction à part entière.

import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Mot de passe AI_PASSWORD, envoyé par l'appli dans l'en-tête X-AI-Password.
 * Sans AI_PASSWORD, tout est ouvert. Comparaison à durée constante.
 */
export function passwordOk(req) {
  const expected = process.env.AI_PASSWORD
  if (!expected) return true
  let given = ''
  try {
    given = decodeURIComponent(String(req.headers?.['x-ai-password'] || ''))
  } catch {
    return false
  }
  const hash = value => createHash('sha256').update(value).digest()
  return timingSafeEqual(hash(given), hash(expected))
}

/** Corps JSON de la requête, ou null s'il est illisible. */
export function readBody(req) {
  const body = req.body || {}
  if (typeof body !== 'string') return body
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}
