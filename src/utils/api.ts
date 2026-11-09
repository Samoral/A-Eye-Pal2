/**
 * Robust API fetch utility for A-Eye Pal.
 * Prevents "SyntaxError: Unexpected token '<', '<!doctype '... is not valid JSON"
 * by validating Content-Type and gracefully handling non-JSON responses (gateway timeouts, HTML 404s/502s).
 */
export async function apiFetch<T = any>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    const rawText = await res.text();
    // Non-JSON response (e.g. gateway error HTML or proxy error)
    const preview = rawText.slice(0, 120).replace(/\s+/g, ' ');
    console.warn(`[apiFetch] Server returned non-JSON response from ${url} (status ${res.status}): ${preview}`);
    throw new Error(
      res.status >= 500
        ? `Server temporarily unavailable (${res.status}). Please try again.`
        : `Unexpected response format from server (${res.status}).`
    );
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Request failed with status ${res.status}`);
  }

  return data as T;
}
