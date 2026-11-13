import { useMemo, useState } from 'react'
import { isSection } from '../utils/parseRecipe'
import { scaleQuantity } from '../utils/servings'
import ServingsStepper from './ServingsStepper'

/**
 * Ingrédients regroupés par partie de recette (pâte, crème…). Une recette sans
 * partie donne un seul groupe sans nom.
 */
function groupByPart(ingredients) {
  const groups = []
  ingredients.forEach((entry, index) => {
    if (isSection(entry)) {
      groups.push({ name: entry.section, items: [] })
      return
    }
    if (!groups.length) groups.push({ name: '', items: [] })
    groups[groups.length - 1].items.push({ ing: entry, index })
  })
  return groups.filter(g => g.items.length)
}

export default function MissingIngredientsModal({ recipe, onDone, onClose }) {
  const ingredients = useMemo(() => recipe.ingredients || [], [recipe.ingredients])
  const groups = useMemo(() => groupByPart(ingredients), [ingredients])
  const [checked, setChecked] = useState(() => ingredients.map(entry => !isSection(entry)))
  const [servings, setServings] = useState(recipe.servings || null)
  const factor = recipe.servings && servings ? servings / recipe.servings : 1

  const toggle = i =>
    setChecked(arr => arr.map((v, idx) => (idx === i ? !v : v)))

  // Une partie qu'on ne prépare pas (pâte achetée toute faite…) se décoche d'un coup
  const toggleGroup = group => {
    const allOn = group.items.every(({ index }) => checked[index])
    const indexes = new Set(group.items.map(({ index }) => index))
    setChecked(arr => arr.map((v, idx) => (indexes.has(idx) ? !allOn : v)))
  }

  const submit = () => {
    // On transmet la quantité avec le nom : la liste de courses en tire
    // ce qui a du sens à l'achat (200 g oui, 2 cuillères non). Un même
    // ingrédient présent dans plusieurs parties y est additionné.
    const missing = ingredients
      .map((ing, i) => ({ ing, i }))
      .filter(({ ing, i }) => checked[i] && !isSection(ing) && ing.name)
      .map(({ ing }) => ({ name: ing.name, quantity: scaleQuantity(ing.quantity, factor) }))
    onDone(missing)
  }

  const showParts = groups.length > 1 || groups[0]?.name

  return (
    <div
      className="overlay"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="overlay-content" onClick={e => e.stopPropagation()}>
        <button className="btn-close" onClick={onClose}>✖</button>
        <h2 className="overlay-title">Il te manque quoi ?</h2>
        <p className="missing-hint">
          « {recipe.title} » — décoche ce que tu as déjà à la maison, le reste part dans la liste de courses.
        </p>

        {recipe.servings && servings && (
          <ServingsStepper value={servings} onChange={setServings} base={recipe.servings} />
        )}

        {groups.length === 0 ? (
          <p className="recipe-picker-empty">Cette recette n'a pas d'ingrédients renseignés.</p>
        ) : (
          <div className="missing-ingredients-list">
            {groups.map((group, g) => {
              const on = group.items.filter(({ index }) => checked[index]).length
              return (
                <div className="missing-group" key={g}>
                  {showParts && (
                    <label className="missing-group-title">
                      <input
                        type="checkbox"
                        checked={on === group.items.length}
                        ref={el => {
                          if (el) el.indeterminate = on > 0 && on < group.items.length
                        }}
                        onChange={() => toggleGroup(group)}
                      />
                      <span>{group.name || 'Divers'}</span>
                    </label>
                  )}
                  {group.items.map(({ ing, index }) => (
                    <label className="missing-ingredient-row" key={index}>
                      <input
                        type="checkbox"
                        checked={checked[index]}
                        onChange={() => toggle(index)}
                      />
                      {ing.quantity && <span className="qty">{scaleQuantity(ing.quantity, factor)}</span>}
                      <span>{ing.name}</span>
                    </label>
                  ))}
                </div>
              )
            })}
          </div>
        )}

        <div className="overlay-footer">
          <button className="btn-modify" onClick={() => onDone([])}>
            Passer
          </button>
          <button className="btn-save" onClick={submit}>
            Ajouter à la liste de courses
          </button>
        </div>
      </div>
    </div>
  )
}
