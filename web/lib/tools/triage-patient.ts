import { tool, generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { Capability } from "@/lib/types";

const CAPABILITIES = [
  "cath_lab", "ct_scan", "trauma_center", "burn_unit", "icu", "ventilator",
  "pediatric", "obstetric", "neurosurgery", "orthopedic", "dialysis",
  "antivenom", "nicu", "blood_bank", "stroke_unit",
] as const;

const TRIAGE_SYSTEM = `You are a medical triage AI for an emergency response system in India.
You receive English translations of emergency calls (originally in Indian languages).

Your job:
1. Extract medical symptoms from colloquial language
2. Infer the likely condition + 1–3 differential diagnoses
3. Classify using Emergency Severity Index (ESI):
   - ESI-1: Immediate life-threatening (cardiac arrest, not breathing, massive hemorrhage)
   - ESI-2: High risk / altered mental status / severe pain (stroke, chest pain, major trauma)
   - ESI-3: Multiple resources needed (fracture + laceration, moderate burns)
   - ESI-4: One resource needed (simple laceration, minor sprain)
   - ESI-5: No resources needed (cold symptoms, minor rash)
4. Determine required hospital capabilities
5. Estimate time criticality (minutes before intervention is needed)

Map everyday descriptions to medical terms:
- "face drooping" / "slurred speech" / "one side weak" → stroke (ESI-1/2)
- "grabbed his chest and fell" → cardiac event (ESI-1)
- "snake bit" → snakebite envenomation (ESI-2)
- "fell from height" → trauma/fractures (ESI-2/3)
- "not breathing" → respiratory arrest (ESI-1)
- "unconscious" → altered consciousness (ESI-1)

You are a Clinical Decision Support tool, NOT a diagnostic system. Always include the disclaimer.`;

// Zod schema — generateObject uses this for guaranteed structured output
const TriageSchema = z.object({
  symptoms: z
    .array(
      z.object({
        key: z.string().describe("Category: Emergency, Symptom, Patient, Concern, Urgency"),
        value: z.string().describe("Description of the finding"),
        critical: z.boolean(),
      })
    )
    .describe("Extracted medical symptoms from the transcript"),
  likelyCondition: z.string().describe("Most likely medical condition"),
  differentialDiagnoses: z.array(z.string()).max(3).describe("Up to 3 alternative diagnoses"),
  severity: z.enum(["CRITICAL", "HIGH", "MODERATE", "LOW"]),
  esiLevel: z.number().int().min(1).max(5).describe("Emergency Severity Index (1=most urgent)"),
  triageScore: z.number().int().min(1).max(10).describe("Granular triage score 1-10"),
  requiredCapabilities: z.array(z.enum(CAPABILITIES)).describe("Hospital capabilities needed"),
  recommendedFirstAid: z.array(z.string()).describe("Bystander first-aid steps"),
  reasoning: z.string().describe("Brief clinical reasoning, 1-2 sentences"),
  confidence: z.number().min(0).max(1).describe("Model confidence in assessment"),
  timeCriticalityMinutes: z.number().int().describe("Minutes until intervention needed"),
  patientDemographics: z.string().describe("Age/gender if discernible, else 'unknown'"),
});

export const triagePatient = tool({
  description:
    "Run medical triage on the caller's transcript. Returns ESI level (1=most urgent, 5=least), severity, required hospital capabilities, time criticality in minutes, and recommended first aid for bystanders. Call this FIRST before any dispatch action — every other tool depends on its output.",
  inputSchema: z.object({
    transcript: z
      .string()
      .describe("English transcript of the emergency call. Translate first if needed."),
    language: z
      .string()
      .default("en")
      .describe("Original language code: kn, hi, ta, te, en"),
  }),
  execute: async ({ transcript, language }) => {
    try {
      const { object } = await generateObject({
        model: anthropic("claude-haiku-4-5-20251001"),
        system: TRIAGE_SYSTEM,
        prompt: `Emergency call transcript (translated from ${language}):\n"${transcript}"`,
        schema: TriageSchema,
        maxRetries: 2,
      });

      return {
        ...object,
        requiredCapabilities: object.requiredCapabilities as Capability[],
        disclaimer: "AI-assisted triage — not a medical diagnosis. Final decisions made by medical professionals.",
        _card: {
          type: "triage",
          severity: object.severity,
          esi: object.esiLevel,
          condition: object.likelyCondition,
          timeWindow: object.timeCriticalityMinutes,
          capabilities: object.requiredCapabilities,
          firstAid: object.recommendedFirstAid,
          reasoning: object.reasoning,
          disclaimer: "AI-assisted triage — not a medical diagnosis.",
        },
      };
    } catch (err) {
      console.error("[triagePatient] error:", err);
      return {
        error: "Triage failed",
        message: (err as Error).message,
        severity: "HIGH" as const,
        esiLevel: 2 as const,
        requiredCapabilities: ["icu"] as Capability[],
        timeCriticalityMinutes: 15,
        disclaimer: "AI-assisted triage failed — escalate to human dispatcher immediately.",
      };
    }
  },
});
