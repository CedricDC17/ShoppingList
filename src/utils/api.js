// src/utils/api.js
// Appels aux fonctions serveur du dossier api/ (Vercel), avec le mot de passe
// AI_PASSWORD : demandé au premier appel refusé, puis retenu sur l'appareil.

const PASSWORD_KEY = 'ai-password'

function storedPassword() {
  try {
    return localStorage.getItem(PASSWORD_KEY) || ''
  } catch {
    return ''
  }
}

function storePassword(value) {
  try {
    if (value) localStorage.setItem(PASSWORD_KEY, value)
    else localStorage.removeItem(PASSWORD_KEY)
  } catch {
    // Stockage indisponible (navigation privée) : redemandé à chaque fois
  }
}

/**
 * POST JSON vers une fonction serveur.
 * @returns {{ ok, status, data }} — status 0 si le serveur est injoignable.
 * Lève une erreur si l'utilisateur ne donne pas le mot de passe.
 */
export async function postApi(path, payload, password = storedPassword()) {
  let response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Encodé : un en-tête HTTP n'accepte pas les accents tels quels
        'X-AI-Password': encodeURIComponent(password),
      },
      body: JSON.stringify(payload),
    })
  } catch {
    return { ok: false, status: 0, data: {} }
  }
  const data = await response.json().catch(() => ({}))
  if (response.ok) {
    storePassword(password)
    return { ok: true, status: response.status, data }
  }

  if (response.status === 401) {
    storePassword('')
    const entered = window.prompt(
      password ? 'Mot de passe incorrect. Réessaie :' : "Mot de passe de l'IA :"
    )
    if (!entered?.trim()) throw new Error('Il faut le mot de passe pour continuer.')
    return postApi(path, payload, entered.trim())
  }
  return { ok: false, status: response.status, data }
}

/* ============================== Import par lien ============================== */

const IMPORT_MESSAGES = {
  'bad-url': "Ce lien n'est pas valide.",
  unreachable: "Impossible d'ouvrir cette page. Vérifie le lien.",
  'not-found': 'Page introuvable : vérifie le lien.',
  blocked: "Ce site refuse l'import automatique. Copie le texte de la recette et colle-le ici.",
  'not-html': 'Ce lien ne mène pas à une page de recette.',
  'no-recipe':
    "Pas de recette lisible sur cette page. Copie le texte de la recette et colle-le ici, puis « Formater avec l'IA ».",
  timeout: 'Le site a mis trop de temps à répondre. Réessaie.',
}

/**
 * Lien d'une page de recette -> { text, image }
 *   text   recette au format de l'appli (relue par parseRecipeText)
 *   image  photo de la recette en data URL, ou ''
 */
export async function importRecipeFromUrl(url) {
  const { ok, status, data } = await postApi('/api/import', { url })
  if (ok && data.text) {
    const image = String(data.image || '')
    return { text: String(data.text), image: image.startsWith('data:image/') ? image : '' }
  }
  if (status === 0) throw new Error("Pas de connexion : impossible d'importer.")
  if (status === 404 && !data.error) throw new Error("La fonction d'import est introuvable sur ce serveur.")
  throw new Error(IMPORT_MESSAGES[data.error] || 'Import impossible. Copie plutôt le texte de la recette.')
}
