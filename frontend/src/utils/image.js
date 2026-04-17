/**
 * Converts a stored image_url value to a usable src.
 * - Empty/null → null
 * - External URL (http/https) → returned as-is (backward compat)
 * - Filename only (e.g. "cultivate.jpg") + groupName (e.g. "The Blade Itself 3")
 *   → /api/images/The_Blade_Itself/3/cultivate.jpg
 * - Filename only without groupName → /api/images/cultivate.jpg
 */
export function getImageUrl(imageUrl, groupName) {
  if (!imageUrl) return null
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) return imageUrl

  if (groupName) {
    // Match trailing number separated by a space or underscore
    // e.g. "The Blade Itself 3" or "The_Silent_Patient_1"
    const m = groupName.match(/^(.+?)[\s_]+(\d+)$/)
    if (m) {
      const bookFolder = m[1].trim().replace(/[\s]+/g, '_')
      return `/api/images/${bookFolder}/${m[2]}/${imageUrl}`
    }
    return `/api/images/${groupName.replace(/\s+/g, '_')}/${imageUrl}`
  }

  return `/api/images/${imageUrl}`
}
