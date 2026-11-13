// src/utils/clipboard.js

/**
 * Copie un texte dans le presse-papier. L'API moderne n'existe qu'en HTTPS
 * (ou localhost) : sur le serveur de dev ouvert depuis un téléphone, on se
 * rabat sur l'ancienne méthode par zone de texte sélectionnée.
 * @returns true si la copie a réussi
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // on tente la méthode de repli
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return ok
}
