// src/components/RecipeSheet.jsx
import { useCallback, useEffect, useState } from 'react'
import { updateDoc, deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { preparePhoto } from '../utils/image'
import {
  ChevronLeft, Pencil, Trash2, ImagePlus, RotateCcw, CookingPot, Check, AlertTriangle,
} from 'lucide-react'
import {
  parseIngredientsText,
  parseStepsText,
  parseRecipeText,
  ingredientsToText,
  stepsToText,
  isSection,
  countIngredients,
  splitStepLabel,
} from '../utils/parseRecipe'
import { scaleQuantity } from '../utils/servings'
import { TAG_GROUPS } from '../utils/tags'
import RecipeAITools from './RecipeAITools'
import ServingsStepper from './ServingsStepper'
import useWakeLock from '../hooks/useWakeLock'
import useDismissable from '../hooks/useDismissable'

const FAMILY_ID = 'sharedFamily'

/** Document séparé pour la photo : la liste des recettes ne doit pas la charger. */
const photoRef = id => doc(db, 'families', FAMILY_ID, 'recipePhotos', id)
const recipeRef = id => doc(db, 'families', FAMILY_ID, 'recipes', id)

function messageErreurPhoto(err) {
  if (err?.message === 'photo-trop-lourde') {
    return "Cette photo est trop lourde même après compression. Essaie une image moins grande. Le reste de la recette a été enregistré."
  }
  if (err?.code === 'permission-denied') {
    return "Les règles de sécurité Firestore refusent l'enregistrement de la photo. Le reste de la recette a été enregistré."
  }
  return "La photo n'a pas pu être enregistrée. Le reste de la recette a été enregistré."
}

export default function RecipeSheet({ recipe, onClose, onSave }) {
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [photoStep, setPhotoStep] = useState('')
  const [saveError, setSaveError] = useState('')

  // Brouillon d'édition
  const [title, setTitle] = useState('')
  const [servings, setServings] = useState('')
  const [ingredientsText, setIngredientsText] = useState('')
  const [stepsText, setStepsText] = useState('')
  const [notes, setNotes] = useState('')
  const [tags, setTags] = useState([])
  const [imageUrl, setImageUrl] = useState('')
  const [imageFile, setImageFile] = useState(null)

  // Nombre de personnes affiché : les quantités sont recalculées à la volée
  const [shownServings, setShownServings] = useState(null)

  // Mode cuisine : ce qui est déjà fait, le temps de la préparation
  const [doneIngredients, setDoneIngredients] = useState([])
  const [doneSteps, setDoneSteps] = useState([])

  useEffect(() => {
    if (!recipe) return
    setEditMode(false)
    setTitle(recipe.title || '')
    setServings(recipe.servings ? String(recipe.servings) : '')
    setShownServings(recipe.servings || null)
    setIngredientsText(ingredientsToText(recipe.ingredients || []))
    setStepsText(stepsToText(recipe.steps || []))
    setNotes(recipe.notes || '')
    setTags(recipe.tags || [])
    setImageUrl(recipe.thumbUrl || recipe.imageUrl || '')
    setImageFile(null)
    setDoneIngredients([])
    setDoneSteps([])
    setSaveError('')
    setPhotoStep('')
    // Dépendance sur l'identifiant seulement : après un enregistrement, le parent
    // renvoie un nouvel objet recette. Dépendre de l'objet relancerait cet effet
    // et effacerait aussitôt le mode édition et le message d'erreur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe.id])

  // La photo complète vit dans un document séparé : on la charge à l'ouverture
  // de la fiche seulement. La miniature s'affiche en attendant.
  useEffect(() => {
    if (!recipe?.id || !(recipe.thumbUrl || recipe.imageUrl)) return
    let annule = false
    getDoc(photoRef(recipe.id))
      .then(snap => {
        const dataUrl = snap.data()?.dataUrl
        if (!annule && dataUrl) setImageUrl(dataUrl)
      })
      .catch(err => console.error('Lecture de la photo impossible :', err))
    return () => { annule = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe.id])

  // Écran maintenu allumé pendant la lecture (pas pendant l'édition)
  useWakeLock(!editMode)

  const requestClose = useCallback(() => {
    if (editMode) {
      setEditMode(false)
      return
    }
    onClose()
  }, [editMode, onClose])

  useDismissable(true, requestClose)

  // Texte de la recette en cours d'édition, tel que l'IA le recevra
  const draftText = () =>
    [
      title,
      servings && `Pour ${servings} personnes`,
      `Ingrédients :\n${ingredientsText}`,
      `Préparation :\n${stepsText}`,
      tags.length ? `Tags : ${tags.join(', ')}` : '',
      notes.trim() && `Notes :\n${notes}`,
    ]
      .filter(Boolean)
      .join('\n\n')

  // Recette remise en forme par l'IA : on redistribue dans les champs d'édition
  const applyFormatted = text => {
    const parsed = parseRecipeText(text)
    if (parsed.title) setTitle(parsed.title)
    setServings(parsed.servings ? String(parsed.servings) : '')
    setIngredientsText(ingredientsToText(parsed.ingredients))
    setStepsText(stepsToText(parsed.steps))
    setNotes(parsed.notes)
    if (parsed.tags.length) setTags(parsed.tags)
  }

  const toggleTag = tag =>
    setTags(list => (list.includes(tag) ? list.filter(t => t !== tag) : [...list, tag]))

  const toggleDone = (list, setList, index) =>
    setList(l => (l.includes(index) ? l.filter(i => i !== index) : [...l, index]))

  const anyDone = doneIngredients.length > 0 || doneSteps.length > 0
  const resetProgress = () => {
    setDoneIngredients([])
    setDoneSteps([])
  }

  async function saveAll() {
    if (!recipe || saving) return
    setSaving(true)
    setSaveError('')

    // Miniature affichée sur les cartes ; la photo complète vit dans un
    // document séparé pour que la liste des recettes reste légère.
    // On repart TOUJOURS de la valeur enregistrée : imageUrl peut contenir une
    // adresse "blob:" temporaire (aperçu local) qui ne doit jamais aller en base.
    let thumb = recipe.thumbUrl || recipe.imageUrl || ''
    let photoFailed = false

    try {
      if (imageFile) {
        setPhotoStep('Compression…')
        const { full, thumb: mini } = await preparePhoto(imageFile)
        setPhotoStep('Enregistrement…')
        await setDoc(photoRef(recipe.id), { dataUrl: full, updatedAt: Date.now() })
        thumb = mini
        setImageFile(null)
        setImageUrl(full)
      } else if (!imageUrl && (recipe.thumbUrl || recipe.imageUrl)) {
        await deleteDoc(photoRef(recipe.id)).catch(() => {})
        thumb = ''
      }
    } catch (err) {
      photoFailed = true
      thumb = recipe.thumbUrl || recipe.imageUrl || '' // on conserve l'ancienne
      console.error('Enregistrement de la photo impossible :', err?.code || '', err)
      setSaveError(messageErreurPhoto(err))
    } finally {
      setPhotoStep('')
    }

    const servingsNumber = parseInt(servings, 10)
    const updated = {
      title: title.trim(),
      servings: servingsNumber > 0 && servingsNumber < 100 ? servingsNumber : null,
      ingredients: parseIngredientsText(ingredientsText),
      steps: parseStepsText(stepsText),
      notes,
      tags,
      thumbUrl: thumb,
      imageUrl: '', // ancien champ Storage, désormais inutilisé
    }
    await updateDoc(recipeRef(recipe.id), updated)
    onSave({ ...recipe, ...updated })
    setShownServings(updated.servings)
    setSaving(false)
    // En cas d'échec photo, on reste en édition pour que le message soit vu
    if (!photoFailed) setEditMode(false)
  }

  async function deleteCurrent() {
    if (!confirm('Supprimer définitivement cette recette ?')) return
    await deleteDoc(recipeRef(recipe.id))
    await deleteDoc(photoRef(recipe.id)).catch(() => {})
    onClose()
  }

  function onFileChange(e) {
    const file = e.target.files[0]
    if (file) {
      setImageFile(file)
      setImageUrl(URL.createObjectURL(file))
    }
  }

  const ingredients = recipe.ingredients || []
  const steps = recipe.steps || []
  const ingredientCount = countIngredients(ingredients)
  const stepCount = steps.filter(st => !isSection(st)).length
  const factor = recipe.servings && shownServings ? shownServings / recipe.servings : 1

  // Numérotation des étapes : elle repart de 1 à chaque partie
  const stepNumbers = []
  steps.reduce((n, st) => {
    const next = isSection(st) ? 0 : n + 1
    stepNumbers.push(next)
    return next
  }, 0)

  return (
    <div className="recipe-sheet">
      {/* ---------------- Barre supérieure ---------------- */}
      <header className="sheet-bar">
        <button className="sheet-bar-back" onClick={requestClose}>
          <ChevronLeft size={22} />
          <span>{editMode ? 'Annuler' : 'Retour'}</span>
        </button>

        {editMode ? (
          <button className="sheet-bar-action primary" onClick={saveAll} disabled={saving}>
            {saving ? photoStep || 'Enregistrement…' : 'Enregistrer'}
          </button>
        ) : (
          <button className="sheet-bar-action" onClick={() => setEditMode(true)}>
            <Pencil size={16} /> Modifier
          </button>
        )}
      </header>

      <div className="sheet-scroll">
        {saveError && (
          <p className="sheet-error" role="alert">
            <AlertTriangle size={18} /> {saveError}
          </p>
        )}

        {/* ---------------- Visuel ---------------- */}
        {imageUrl && <img src={imageUrl} alt="" className="recipe-hero" />}

        {editMode && (
          <div className="hero-actions">
            <label className="btn-ghost">
              <ImagePlus size={16} /> {imageUrl ? 'Changer la photo' : 'Ajouter une photo'}
              <input type="file" accept="image/*" onChange={onFileChange} hidden />
            </label>
            {imageUrl && (
              <button
                className="btn-ghost danger"
                onClick={() => { setImageUrl(''); setImageFile(null) }}
              >
                Retirer
              </button>
            )}
          </div>
        )}

        {/* ---------------- Titre ---------------- */}
        {editMode ? (
          <>
            <input
              className="sheet-title-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Titre de la recette"
            />
            <label className="servings-field">
              Pour
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max="99"
                value={servings}
                onChange={e => setServings(e.target.value)}
                placeholder="—"
              />
              personnes
            </label>
            <RecipeAITools getText={draftText} onApply={applyFormatted} />
          </>
        ) : (
          <>
            <h1 className="sheet-title">{recipe.title}</h1>
            {recipe.servings && shownServings && (
              <ServingsStepper value={shownServings} onChange={setShownServings} base={recipe.servings} />
            )}
          </>
        )}

        {/* ---------------- Tags ---------------- */}
        {editMode ? (
          <div className="block">
            <h2 className="block-title">Tags</h2>
            {TAG_GROUPS.map(group => (
              <div className="tag-group" key={group.group}>
                <span className="tag-group-label">{group.group}</span>
                <div className="tag-group-chips">
                  {group.tags.map(tag => (
                    <button
                      key={tag}
                      className={`tag-chip${tags.includes(tag) ? ' active' : ''}`}
                      onClick={() => toggleTag(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          (recipe.tags?.length > 0 || anyDone) && (
            <div className="sheet-meta">
              {recipe.tags?.map(t => (
                <span key={t} className="tag-chip small">{t}</span>
              ))}
              {anyDone && (
                <button className="btn-ghost small" onClick={resetProgress}>
                  <RotateCcw size={14} /> Réinitialiser
                </button>
              )}
            </div>
          )
        )}

        {/* ---------------- Ingrédients ---------------- */}
        {(editMode || ingredientCount > 0) && (
          <div className="block">
            <h2 className="block-title">
              Ingrédients
              {!editMode && ingredientCount > 0 && (
                <span className="block-count">
                  {doneIngredients.length}/{ingredientCount}
                </span>
              )}
            </h2>

            {editMode ? (
              <>
                <textarea
                  className="sheet-textarea"
                  value={ingredientsText}
                  onChange={e => setIngredientsText(e.target.value)}
                  placeholder={'Un ingrédient par ligne :\n200 g de farine\n3 oeufs\nsel'}
                />
                <p className="field-hint">
                  Un par ligne. Les quantités sont reconnues automatiquement, avant ou après le nom.
                  Une ligne qui finit par « : » (ex. « Pâte : ») commence une partie.
                </p>
              </>
            ) : (
              <ul className="check-list">
                {ingredients.map((ing, i) =>
                  isSection(ing) ? (
                    <li key={i} className="list-section">{ing.section}</li>
                  ) : (
                    <li
                      key={i}
                      className={doneIngredients.includes(i) ? 'done' : ''}
                      onClick={() => toggleDone(doneIngredients, setDoneIngredients, i)}
                    >
                      <span className="check-box">
                        {doneIngredients.includes(i) && <Check size={14} strokeWidth={3} />}
                      </span>
                      <span className="check-text">
                        {ing.quantity && <b>{scaleQuantity(ing.quantity, factor)}</b>} {ing.name}
                      </span>
                    </li>
                  )
                )}
              </ul>
            )}
          </div>
        )}

        {/* ---------------- Préparation ---------------- */}
        {(editMode || stepCount > 0) && (
          <div className="block">
            <h2 className="block-title">
              Préparation
              {!editMode && stepCount > 0 && (
                <span className="block-count">{doneSteps.length}/{stepCount}</span>
              )}
            </h2>

            {editMode ? (
              <>
                <textarea
                  className="sheet-textarea"
                  value={stepsText}
                  onChange={e => setStepsText(e.target.value)}
                  placeholder={'Une étape par ligne :\nPréchauffer le four\nMélanger les ingrédients'}
                />
                <p className="field-hint">
                  Une étape par ligne, la numérotation est ajoutée toute seule. « Titre court : détail »
                  met le titre en gras. Une ligne qui finit par « : » commence une partie.
                </p>
              </>
            ) : (
              <ol className="step-list">
                {steps.map((st, i) => {
                  if (isSection(st)) return <li key={i} className="list-section">{st.section}</li>
                  const { label, text } = splitStepLabel(st)
                  return (
                    <li
                      key={i}
                      className={doneSteps.includes(i) ? 'done' : ''}
                      onClick={() => toggleDone(doneSteps, setDoneSteps, i)}
                    >
                      <span className="step-num">{stepNumbers[i]}</span>
                      <span className="check-text">
                        {label && <strong className="step-label">{label}</strong>}
                        {label ? ' ' : ''}
                        {text}
                      </span>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        )}

        {/* ---------------- Notes ---------------- */}
        {(editMode || recipe.notes) && (
          <div className="block">
            <h2 className="block-title">Notes</h2>
            {editMode ? (
              <textarea
                className="sheet-textarea short"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Nombre de portions, variantes, astuces…"
              />
            ) : (
              <p className="sheet-notes">{recipe.notes}</p>
            )}
          </div>
        )}

        {/* Fiche vide : on invite à la compléter plutôt que d'afficher des blocs vides */}
        {!editMode && ingredientCount === 0 && stepCount === 0 && (
          <div className="sheet-empty">
            <CookingPot size={32} />
            <p>Cette fiche est vide.</p>
            <button className="btn-primary" onClick={() => setEditMode(true)}>
              Compléter la recette
            </button>
          </div>
        )}

        {/* Suppression : en bas, en mode édition seulement */}
        {editMode && (
          <button className="btn-danger-outline full" onClick={deleteCurrent}>
            <Trash2 size={16} /> Supprimer cette recette
          </button>
        )}
      </div>
    </div>
  )
}
