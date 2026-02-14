/**
 * AI-powered medical triage service
 * Calls the Vite dev server middleware endpoint POST /api/triage
 * Falls back to null if unavailable so the caller can use keyword extraction
 */

export interface TriageResult {
  symptoms: { key: string; value: string; critical: boolean }[];
  likelyCondition: string;
  severity: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
  requiredCapabilities: string[];
  triageScore: number;
  reasoning: string;
}

/**
 * Call Claude API via Vite middleware to extract symptoms from natural language.
 * Returns null on any error — caller should fall back to keyword extraction.
 */
export async function extractSymptomsAI(
  englishText: string,
  originalKannada?: string
): Promise<TriageResult | null> {
  try {
    const response = await fetch('/api/triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ englishText, originalKannada }),
    })

    if (!response.ok) return null

    const data = await response.json()

    // Server returns { fallback: true } when API key missing or error
    if (data.fallback) return null

    return data as TriageResult
  } catch {
    return null
  }
}
