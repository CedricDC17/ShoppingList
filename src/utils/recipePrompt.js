// src/utils/recipePrompt.js
//
// Consignes de mise en forme d'une recette par une IA. Partagées par :
//   - le bouton « Copier le prompt » (on colle dans ChatGPT, Claude…)
//   - la fonction serveur api/ai.js (bouton « Formater avec l'IA »)
// Le format demandé est exactement celui que lit parseRecipeText().
//
// Imports avec extension .js : ce fichier est aussi chargé par Node côté serveur.

import { ALL_TAGS } from './tags.js'
import { RAYONS } from './rayons.js'

export const RECIPE_INSTRUCTIONS = `Tu remets en forme des recettes de cuisine pour une application. Ta réponse sera collée telle quelle dans l'application : elle contient uniquement la recette, en texte brut, sans rien avant ni après.

FORMAT EXACT (structure seulement : ces valeurs sont fictives, n'en recopie jamais aucune)

Titre de la recette
Pour 4 personnes

Ingrédients :
200 g farine
3 oeufs
1 c. à soupe huile d'olive
sel

Préparation :
Préchauffer le four : 180 °C, chaleur tournante.
Mélanger : farine et oeufs jusqu'à obtenir une pâte lisse.

Tags : Plat, Rapide
Notes :
Préparation 15 min · Cuisson 30 min
Se conserve 2 jours au frais.

RÈGLES GÉNÉRALES
- Tout en français : traduis si la recette est dans une autre langue.
- Aucun markdown (pas de #, *, gras), aucune puce, aucun numéro, aucun emoji, aucun hashtag, aucune mention.
- Supprime tout le superflu : introduction, anecdotes, « bon appétit », appels à s'abonner, liker ou commenter, liens, publicité, enthousiasme.
- N'invente rien : aucun ingrédient, quantité, étape, temps ou astuce absent de l'original. Une quantité inconnue reste absente.
- N'oublie rien : chaque ingrédient et chaque action de l'original se retrouvent dans ta version.
- « Pour N personnes » : seulement si l'original l'indique (portions, parts, personnes). Sinon, omets la ligne.

INGRÉDIENTS
- Une ligne par ingrédient : quantité, unité, nom. Pas de « de » entre l'unité et le nom.
- Unités métriques : g, kg, ml, cl, L. Convertis cups, oz, lb, sticks… et arrondis à des valeurs simples. Garde c. à soupe, c. à café, pincée, gousse, tranche quand c'est la mesure naturelle.
- Le nom est celui d'une liste de courses : court, sans adjectif inutile (« 2 belles tomates bien mûres » → « 2 tomates »). Garde ce qui change le produit acheté (huile d'olive, sucre glace, beurre demi-sel, farine T55).
- La découpe ou la préparation (émincé, fondu, en dés) ne figure pas dans l'ingrédient : elle va dans les étapes.
- « Sel, poivre » : une ligne chacun.

PRÉPARATION
- Une étape par ligne, qui commence par un titre court à l'infinitif suivi de « : », puis le détail (« Précuire la pâte : enfourner à blanc 10 min à 200 °C. »).
- Une ou deux actions par étape. Phrases courtes et claires.
- Températures en °C, durées en min ou h. Garde les repères utiles (durées, températures, texture attendue).

RECETTES EN PLUSIEURS PARTIES
- Si la recette a des parties distinctes (pâte, garniture, crème, sauce, glaçage…), garde-les séparées : le nom court de la partie seul sur sa ligne, suivi de « : », puis ses ingrédients. Même découpage dans la préparation, avec les mêmes noms dans le même ordre. L'assemblage final peut former une partie « Montage : ».
- Ne fusionne jamais deux parties, même si elles partagent un ingrédient.
- Une recette sans parties distinctes n'en a pas : ne crée pas de partie unique.

Exemple de parties :
Ingrédients :
Pâte :
250 g farine
125 g beurre
Crème :
3 citrons
50 g beurre

Préparation :
Pâte :
Sabler la pâte : mélanger la farine et le beurre du bout des doigts.
Crème :
Presser les citrons : récupérer le jus et le zeste.

TAGS
- De 1 à 4 tags, uniquement parmi : ${ALL_TAGS.join(', ')}.
- « Rapide » si moins de 30 min au total. « Végé » si ni viande ni poisson.

NOTES
- Première ligne : les temps donnés par l'original (préparation, cuisson, repos) séparés par « · ». Sans temps dans l'original, pas de ligne de temps.
- Ensuite, au plus deux lignes d'astuce, de variante ou de conservation tirées de l'original.
- Omets la section si l'original ne donne ni temps ni astuce.`

/**
 * Prompt complet pour une IA externe. Sans recette, il se termine par
 * l'invite de collage : on colle sa recette juste après.
 */
export function buildRecipePrompt(recipeText = '') {
  const text = String(recipeText).trim()
  return `${RECIPE_INSTRUCTIONS}\n\nRECETTE À REFORMATER :\n\n${text}${text ? '\n' : ''}`
}

/* ------------------------------ Rayons ------------------------------ */

export const RAYON_INSTRUCTIONS = `Tu ranges des articles de supermarché français dans des rayons.

Rayons possibles (identifiant : description) :
${RAYONS.map(r => `${r.id} : ${r.label}`).join('\n')}

Réponds uniquement avec un objet JSON qui associe chaque article, écrit exactement comme reçu, à l'identifiant de son rayon. Exemple : {"Pâte brisée": "laitiers-frais", "Lessive": "entretien"}
Range chaque article là où on le trouve le plus souvent dans un supermarché français (la pâte brisée est au rayon frais, la crème fraîche aussi). N'utilise "autre" que si aucun rayon ne convient.`
