// src/utils/ai.js
// Appels à la fonction serveur /api/ai (voir api/ai.js). La clé API reste
// côté serveur : le front n'envoie que le texte à traiter.

const MESSAGES = {
  'not-configured': "L'IA n'est pas configurée : la clé API manque côté serveur.",
  'too-long': 'Texte trop long pour être mis en forme.',
  empty: 'Rien à mettre en forme.',
  timeout: "L'IA a mis trop de temps à répondre. Réessaie.",
}

async function callAI(payload) {
  let response
  try {
    response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new Error("Pas de connexion : l'IA n'est pas joignable.")
  }
  const data = await response.json().catch(() => ({}))
  if (response.ok) return data

  if (response.status === 429) {
    throw new Error('Le modèle gratuit est saturé. Réessaie dans une minute.')
  }
  if (response.status === 404) {
    throw new Error("La fonction IA est introuvable sur ce serveur.")
  }
  throw new Error(
    MESSAGES[data.error] ||
      "L'IA n'a pas répondu correctement. Réessaie, ou passe par « Copier le prompt »."
  )
}

/** Recette en vrac -> texte au format de l'appli (relu ensuite par parseRecipeText). */
export async function formatRecipeWithAI(text) {
  const data = await callAI({ task: 'recipe', text })
  return String(data.text || '')
}

/**
 * Propose un rayon pour chaque nom d'article, par lots.
 * @param onProgress (faits, total)
 * @returns { [nom]: idRayon }
 */
export async function classifyRayonsWithAI(names, onProgress) {
  const BATCH = 60
  const result = {}
  for (let i = 0; i < names.length; i += BATCH) {
    const data = await callAI({ task: 'rayons', items: names.slice(i, i + BATCH) })
    Object.assign(result, data.rayons || {})
    onProgress?.(Math.min(i + BATCH, names.length), names.length)
  }
  return result
}
