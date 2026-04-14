/**
 * Converts a stored image_url value to a usable src.
 * - Empty/null → null
 * - External URL (http/https) → returned as-is (backward compat)
 * - Filename only (e.g. "apple.jpg") → /api/images/apple.jpg
 */
export function getImageUrl(imageUrl) {
  if (!imageUrl) return null
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) return imageUrl
  return `/api/images/${imageUrl}`
}
