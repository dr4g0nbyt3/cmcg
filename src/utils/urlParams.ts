/**
 * Parse URL query parameters into a variable override map.
 *
 * Supports two patterns:
 *   ?adImage=https://...         → { "$adImage": "https://..." }
 *   ?$adImage=https://...        → { "$adImage": "https://..." }
 *
 * The $ prefix is added automatically if missing, so both forms work.
 * Non-variable params (like "manifest") are excluded.
 */
export function parseVariablesFromURL(
  search: string = window.location.search,
  reservedKeys: string[] = ['manifest'],
): Record<string, string> {
  const params = new URLSearchParams(search);
  const variables: Record<string, string> = {};

  for (const [key, value] of params.entries()) {
    if (reservedKeys.includes(key)) continue;
    const varName = key.startsWith('$') ? key : `$${key}`;
    variables[varName] = value;
  }

  return variables;
}
