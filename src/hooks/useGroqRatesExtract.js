// src/hooks/useGroqRatesExtract.js
import { useState } from 'react'

const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_KEY   = import.meta.env.VITE_GROQ_API_KEY || ''

// ── Slot normalization ───────────────────────────────────────────────────────
function normSlot(s) {
  return String(s || '')
    .toUpperCase().trim()
    .replace(/\s+/g, '')
    .replace(/HOURS?$/, 'HRS')
    .replace(/^(\d+)H$/, '$1HRS')
    .replace(/^(\d+)HR$/, '$1HRS')
    .replace(/_\d+$/, '')
}
function extractNumber(s) {
  const m = String(s || '').match(/(\d+)/)
  return m ? parseInt(m[1]) : null
}
function matchSlotKey(extracted, systemSlots) {
  const ne = normSlot(extracted)
  const exact = systemSlots.find(s => normSlot(s) === ne)
  if (exact) return exact
  const contains = systemSlots.find(s => {
    const ns = normSlot(s)
    return ns.includes(ne) || ne.includes(ns)
  })
  if (contains) return contains
  const numE = extractNumber(ne)
  const numMatch = systemSlots.find(s => {
    const ns = normSlot(s)
    const numS = extractNumber(ns)
    return numE !== null && numS !== null && numE === numS &&
      (ne.replace(/\d+/, '') === ns.replace(/\d+/, '') ||
       ne.startsWith(String(numE)) || ns.startsWith(String(numS)))
  })
  if (numMatch) return numMatch
  const wordsE = ne.split(/\b/)
  const wordMatch = systemSlots.find(s => {
    const wordsS = normSlot(s).split(/\b/)
    const shared = wordsE.filter(w => w.length > 2 && wordsS.includes(w))
    return shared.length > 0
  })
  return wordMatch || null
}

// ── Room type normalization ──────────────────────────────────────────────────
function normRoom(n) {
  return String(n || '').toLowerCase().replace(/[\s_\-.]/g, '')
}

// Similarity score between two normalized room strings (0 = no match, 1 = identical)
function roomSimilarity(a, b) {
  if (a === b) return 1
  const longer  = a.length >= b.length ? a : b
  const shorter = a.length >= b.length ? b : a
  if (!longer.includes(shorter)) return 0
  return shorter.length / longer.length
}

// ── Global room assignment ───────────────────────────────────────────────────
// Resolves ALL extracted rooms → system rooms together so no two extracted
// rooms steal the same system room. Uses a greedy best-score approach:
// highest-confidence pairs are locked in first.
function buildRoomIdxMap(extractedRooms, systemRooms) {
  const normExtracted = extractedRooms.map(normRoom)
  const normSystem    = systemRooms.map(normRoom)

  // Build full score matrix
  const scores = normExtracted.map(ne =>
    normSystem.map(ns => roomSimilarity(ne, ns))
  )

  // Collect all (extractedIdx, systemIdx, score) pairs with score > 0
  const pairs = []
  scores.forEach((row, ei) =>
    row.forEach((score, si) => { if (score > 0) pairs.push({ ei, si, score }) })
  )

  // Sort by score descending — highest confidence first
  pairs.sort((a, b) => b.score - a.score)

  const roomIdxMap  = {}   // extractedIdx → systemIdx
  const usedSystem  = new Set()
  const usedExtract = new Set()

  for (const { ei, si, score } of pairs) {
    if (usedExtract.has(ei) || usedSystem.has(si)) continue
    roomIdxMap[ei] = si
    usedSystem.add(si)
    usedExtract.add(ei)
  }

  return roomIdxMap
}

// ── Build prompt ─────────────────────────────────────────────────────────────
function buildPrompt(category, systemSlots, systemRooms) {
  const allSlots = [...new Set(Object.values(systemSlots).flat())]
    .map(s => s.replace(/_\d+$/, ''))

  return `Extract ${category.toUpperCase()} hotel/motel rates from this image.

This branch has these time slots configured: ${allSlots.join(', ')}
This branch has these room types: ${systemRooms.join(', ')}

CRITICAL ROOM TYPE RULES:
1. Copy room type names EXACTLY as written in the image — do NOT shorten or abbreviate.
   WRONG: image says "Executive Garage" → you write "Executive"
   RIGHT: image says "Executive Garage" → you write "Executive Garage"
   WRONG: image says "Concept Regency 2" → you write "Regency 2"
   RIGHT: image says "Concept Regency 2" → you write "Concept Regency 2"
2. Every column in the image is a separate room type — never skip or merge columns.
3. Match to the list above only when the name is identical.

IMPORTANT: Use EXACTLY the slot names listed above when they match what you see.
If the image has a slot not in the list (e.g. WEEKLY, MONTHLY), include it using the exact name from the image.

Return ONLY valid JSON — no markdown, no backticks, no explanation:
{
  "roomTypes": ["Econo", "Premium", "Executive", "Executive Garage"],
  "slots": {
    "24HRS": [1160, 1840, 1890, 2100],
    "12HRS": [1000, 1190, 1070, 1300]
  }
}

Rules:
- roomTypes defines the column ORDER — each slot array must match this order exactly
- Use null for empty, dash, or missing cells
- Numbers only — no peso signs or commas
- Include ALL rows visible in the image`
}

// ── Main hook ────────────────────────────────────────────────────────────────
export function useGroqRatesExtract() {
  const [groqStatus, setGroqStatus] = useState(null)

  async function extractAndMap(file, category, systemRooms, systemSlots) {
    if (!GROQ_KEY) {
      setGroqStatus({ type: 'error', message: 'VITE_GROQ_API_KEY not set in .env' })
      return null
    }
    setGroqStatus({ type: 'loading', message: `Scanning ${category} rates image with AI…` })

    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload  = () => res(r.result.split(',')[1])
        r.onerror = rej
        r.readAsDataURL(file)
      })

      const resp = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({
          model: GROQ_MODEL, temperature: 0, max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${file.type || 'image/jpeg'};base64,${base64}` } },
              { type: 'text', text: buildPrompt(category, systemSlots, systemRooms) }
            ]
          }]
        })
      })

      if (!resp.ok) {
        const e = await resp.json()
        throw new Error(e.error?.message || `Groq error ${resp.status}`)
      }

      const data   = await resp.json()
      const text   = data.choices?.[0]?.message?.content || ''

      // Debug — check browser console to see exactly what Groq returned
      // console.log('[useGroqRatesExtract] raw Groq response:', text)

      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())

      // console.log('[useGroqRatesExtract] parsed roomTypes:', parsed.roomTypes)
      // console.log('[useGroqRatesExtract] systemRooms:', systemRooms)

      const extractedRooms = parsed.roomTypes || []
      const extractedSlots = parsed.slots     || {}
      const catSlots       = systemSlots[category] || []

      // ── Resolve ALL room mappings globally (no greedy stealing) ──
      const roomIdxMap = buildRoomIdxMap(extractedRooms, systemRooms)

      // console.log('[useGroqRatesExtract] roomIdxMap:', 
      //   Object.entries(roomIdxMap).map(([ei, si]) => 
      //     `"${extractedRooms[ei]}" → "${systemRooms[si]}"`
      //   )
      // )

      // Map extracted slot names → system slot keys, build rate arrays
      const catRates      = {}
      let   matchedSlots  = 0
      const matchedRooms  = new Set()
      const unmappedSlots = []

      for (const [extractedSlot, values] of Object.entries(extractedSlots)) {
        const slotKey = matchSlotKey(extractedSlot, catSlots)
        if (!slotKey) { unmappedSlots.push(extractedSlot); continue }
        const arr = Array(systemRooms.length).fill(null)
        values.forEach((val, ei) => {
          const si = roomIdxMap[ei]
          if (si !== undefined && val !== null && val !== undefined) {
            arr[si] = Number(val) || 0
            matchedRooms.add(si)
          }
        })
        if (arr.some(v => v !== null)) { catRates[slotKey] = arr; matchedSlots++ }
      }

      const unmappedRooms = extractedRooms.filter((_, ei) => roomIdxMap[ei] === undefined)

      const result = {
        rates:   { [category]: catRates },
        summary: { category, matchedSlots, matchedRooms: matchedRooms.size,
                   totalRooms: systemRooms.length, unmappedRooms, unmappedSlots }
      }

      let msg = `Extracted ${matchedSlots} slot(s) × ${matchedRooms.size} room type(s).`
      if (unmappedRooms.length) msg += ` ⚠️ Unmatched rooms: ${unmappedRooms.join(', ')}`
      if (unmappedSlots.length) msg += ` ⚠️ Unmatched slots: ${unmappedSlots.join(', ')}`

      setGroqStatus({ type: 'success', message: msg })
      setTimeout(() => setGroqStatus(null), 7000)
      return result

    } catch (err) {
      console.error('[useGroqRatesExtract]', err)
      setGroqStatus({ type: 'error', message: err.message || 'Failed to read image. Try a clearer photo.' })
      setTimeout(() => setGroqStatus(null), 8000)
      return null
    }
  }

  return { extractAndMap, groqStatus, clearGroqStatus: () => setGroqStatus(null) }
}