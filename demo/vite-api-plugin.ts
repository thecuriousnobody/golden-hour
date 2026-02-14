import { type Plugin, loadEnv } from 'vite'
import Anthropic from '@anthropic-ai/sdk'

const SYSTEM_PROMPT = `You are a medical triage AI for an emergency response system in India.

You receive English translations of emergency calls (originally in Kannada or other Indian languages).

Your job:
1. Extract medical symptoms from colloquial/everyday language
2. Infer the likely medical condition
3. Assess severity
4. Determine what hospital capabilities are required

Map everyday descriptions to medical terminology:
- "face drooping on one side" → stroke symptoms
- "grabbed his chest and fell down" → cardiac event
- "not able to move legs" → possible spinal injury
- "bleeding from head" → head trauma
- "high fever and shaking" → possible seizure/febrile convulsion
- "fell from height" → trauma/fractures
- "ate something and vomiting" → poisoning/food poisoning
- "snake bit" → snakebite envenomation
- "burning/burns" → burn injury
- "not breathing" → respiratory arrest
- "unconscious" / "not responding" → altered consciousness

Extract patient demographics from context clues:
- "grandfather", "old man" → elderly male
- "child", "baby", "little one" → pediatric
- "pregnant", "expecting" → obstetric emergency

Severity levels: CRITICAL, HIGH, MODERATE, LOW

Required hospital capabilities (pick all that apply):
- cath_lab: cardiac catheterization (heart attacks)
- ct_scan: CT imaging (stroke, head trauma)
- trauma_center: major trauma care
- burn_unit: burn treatment
- icu: intensive care
- ventilator: respiratory support
- pediatric: children's care
- obstetric: pregnancy/delivery
- neurosurgery: brain/spine surgery
- orthopedic: bone/joint surgery
- dialysis: kidney support
- antivenom: snakebite treatment
- nicu: neonatal intensive care
- blood_bank: transfusion services

Respond ONLY with valid JSON in this exact format:
{
  "symptoms": [
    { "key": "Emergency", "value": "description", "critical": true },
    { "key": "Symptom", "value": "description", "critical": true/false },
    { "key": "Patient", "value": "description", "critical": false }
  ],
  "likelyCondition": "Medical condition name",
  "severity": "CRITICAL" | "HIGH" | "MODERATE" | "LOW",
  "requiredCapabilities": ["capability1", "capability2"],
  "triageScore": 1-10,
  "reasoning": "Brief clinical reasoning (1-2 sentences)"
}

The "symptoms" array should use the same key types the UI already uses: Emergency, Symptom, Patient, Concern, Urgency.
Mark life-threatening items as critical: true.
triageScore: 1 = minor, 10 = immediately life-threatening.`

export function apiPlugin(): Plugin {
  // Load ALL env vars (including non-VITE_ prefixed) from demo/.env
  const env = loadEnv('development', process.cwd(), '')

  return {
    name: 'golden-hour-api',
    configureServer(server) {
      server.middlewares.use('/api/triage', async (req, res) => {
        // Only handle POST
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        // Read request body
        let body = ''
        for await (const chunk of req) {
          body += chunk
        }

        let parsed: { englishText: string; originalKannada?: string }
        try {
          parsed = JSON.parse(body)
        } catch {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Invalid JSON' }))
          return
        }

        if (!parsed.englishText) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Missing englishText field' }))
          return
        }

        // Get API key from loaded env (loadEnv reads demo/.env including non-VITE_ vars)
        const apiKey = env.ANTHROPIC_API_KEY
        if (!apiKey) {
          console.warn('[api/triage] No ANTHROPIC_API_KEY found — returning fallback')
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ fallback: true, reason: 'No API key configured' }))
          return
        }

        try {
          const client = new Anthropic({ apiKey })

          const userMessage = parsed.originalKannada
            ? `Emergency call transcript (English translation):\n"${parsed.englishText}"\n\nOriginal Kannada:\n"${parsed.originalKannada}"`
            : `Emergency call transcript (English translation):\n"${parsed.englishText}"`

          const response = await client.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userMessage }],
          })

          // Extract text from response
          const textBlock = response.content.find(b => b.type === 'text')
          if (!textBlock || textBlock.type !== 'text') {
            throw new Error('No text in response')
          }

          // Parse Claude's JSON response — strip markdown code fences if present
          let jsonText = textBlock.text.trim()
          if (jsonText.startsWith('```')) {
            jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
          }
          const triageResult = JSON.parse(jsonText)

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(triageResult))
        } catch (err) {
          console.error('[api/triage] Error:', err)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ fallback: true, reason: String(err) }))
        }
      })
    },
  }
}
