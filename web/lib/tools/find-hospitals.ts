import { tool } from "ai";
import { z } from "zod";
import type { CallerContext, HospitalMatch, Capability } from "@/lib/types";
import { loadSeedHospitals } from "@/lib/hospitals-seed";

const CAPABILITIES = [
  "cath_lab", "ct_scan", "trauma_center", "burn_unit", "icu", "ventilator",
  "pediatric", "obstetric", "neurosurgery", "orthopedic", "dialysis",
  "antivenom", "nicu", "blood_bank", "stroke_unit",
] as const;

// Words that don't help distinguish hospitals from one another.
// Includes chain prefixes (OSF, UnityPoint, Apollo, Fortis, Manipal, etc.) —
// these identify the chain, not the specific facility, so they should not
// drive a capability match on their own.
const STOPWORDS = new Set([
  // Generic
  "hospital", "medical", "center", "centre", "healthcare", "health", "of", "the",
  "and", "&", "for", "system", "campus", "clinic", "memorial", "general",
  "regional", "community", "university", "saint", "st", "st.",
  // Chain prefixes (US)
  "osf", "unitypoint", "carle", "advocate", "ascension", "northwestern", "mercy",
  // Chain prefixes (India)
  "apollo", "fortis", "manipal", "narayana", "max", "medanta", "aiims",
]);

function tokenize(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[.,'-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
  );
}

/** Jaccard similarity over distinctive tokens (stopwords removed). */
function nameSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return inter / union;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100) / 100;
}

/** Score: capability match weighted heavily, distance secondary. */
function score(distanceKm: number, matched: number, required: number): number {
  if (required === 0) return Math.max(0, 100 - distanceKm * 5);
  const capPct = (matched / required) * 80; // up to 80 pts for capabilities
  const distPct = Math.max(0, 20 - distanceKm); // up to 20 pts for proximity
  return Math.round(capPct + distPct);
}

interface GooglePlaceResult {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  internationalPhoneNumber?: string;
  types?: string[];
}

async function googlePlacesSearch(
  lat: number,
  lng: number,
  radiusKm: number
): Promise<GooglePlaceResult[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.internationalPhoneNumber,places.types",
      },
      body: JSON.stringify({
        includedTypes: ["hospital"],
        maxResultCount: 15,
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: Math.min(50000, radiusKm * 1000),
          },
        },
      }),
    });

    if (!res.ok) {
      console.error(`[findHospitals] Google Places HTTP ${res.status}: ${await res.text()}`);
      return [];
    }

    const data = (await res.json()) as { places?: GooglePlaceResult[] };
    return data.places ?? [];
  } catch (err) {
    console.error("[findHospitals] Google Places error:", (err as Error).message);
    return [];
  }
}

export function createFindHospitalsTool(caller: CallerContext) {
  return tool({
    description:
      "Find nearby hospitals filtered by required medical capabilities. Uses Google Places API for live results, falls back to a seed registry of Bangalore hospitals if Places is unavailable. Returns ranked matches — capability fit weighted higher than raw distance. Always pass the requiredCapabilities from triagePatient output.",
    inputSchema: z.object({
      requiredCapabilities: z
        .array(z.enum(CAPABILITIES))
        .describe("Capabilities the receiving hospital must have. From triagePatient output."),
      radiusKm: z.number().default(15).describe("Search radius in kilometers (max 50)"),
      maxResults: z.number().default(5).describe("Max hospitals to return"),
    }),
    execute: async ({ requiredCapabilities, radiusKm, maxResults }) => {
      const { lat, lng } = caller;
      const seed = await loadSeedHospitals();

      // 1. Try Google Places (live data — but it doesn't tell us capabilities)
      const places = await googlePlacesSearch(lat, lng, radiusKm);

      // 2. Build candidates — Google places get capabilities from seed match if name overlap, else assume basic ICU only
      const candidates: HospitalMatch[] = [];

      for (const p of places) {
        const name = p.displayName?.text ?? "Unknown Hospital";
        const pLat = p.location?.latitude ?? lat;
        const pLng = p.location?.longitude ?? lng;
        const distance = haversineKm(lat, lng, pLat, pLng);
        if (distance > radiusKm) continue;

        // Capability inference: pick best seed match by token-Jaccard similarity.
        // Threshold 0.34 ensures we share at least one distinctive token (e.g.
        // "francis", "methodist") and not just generic words like "hospital"
        // or chain prefixes like "OSF" / "UnityPoint" alone.
        let bestMatch: { hospital: typeof seed[number]; score: number } | null = null;
        for (const s of seed) {
          const sim = nameSimilarity(s.name, name);
          if (sim > 0.34 && (!bestMatch || sim > bestMatch.score)) {
            bestMatch = { hospital: s, score: sim };
          }
        }
        const capabilities: Capability[] = bestMatch
          ? (bestMatch.hospital.capabilities as Capability[])
          : ["icu"]; // safe default — unknown facility, assume basic ER/ICU only

        const matched = requiredCapabilities.filter((c) => capabilities.includes(c));
        const missing = requiredCapabilities.filter((c) => !capabilities.includes(c));

        candidates.push({
          id: p.id,
          name,
          address: p.formattedAddress ?? "",
          lat: pLat,
          lng: pLng,
          distanceKm: distance,
          capabilities,
          matchedCapabilities: matched,
          missingCapabilities: missing,
          matchScore: score(distance, matched.length, requiredCapabilities.length),
          phone: p.internationalPhoneNumber,
          source: "google_places",
        });
      }

      // 3. Always also include seed registry — they have known capabilities
      for (const s of seed) {
        const distance = haversineKm(lat, lng, s.lat, s.lng);
        if (distance > radiusKm) continue;
        // Skip duplicates — same token-similarity check used for matching
        if (candidates.some((c) => nameSimilarity(c.name, s.name) > 0.34)) continue;

        const caps = s.capabilities as Capability[];
        const matched = requiredCapabilities.filter((c) => caps.includes(c));
        const missing = requiredCapabilities.filter((c) => !caps.includes(c));

        candidates.push({
          id: `seed:${s.name}`,
          name: s.name,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
          distanceKm: distance,
          capabilities: caps,
          matchedCapabilities: matched,
          missingCapabilities: missing,
          matchScore: score(distance, matched.length, requiredCapabilities.length),
          phone: s.phone,
          source: "seed",
        });
      }

      candidates.sort((a, b) => b.matchScore - a.matchScore);
      const top = candidates.slice(0, maxResults);

      return {
        count: top.length,
        radiusKm,
        requiredCapabilities,
        hospitals: top,
        usedFallback: places.length === 0,
        _cards: top.map((h) => ({
          type: "hospital_match",
          name: h.name,
          distanceKm: h.distanceKm,
          matched: h.matchedCapabilities,
          missing: h.missingCapabilities,
          matchScore: h.matchScore,
          phone: h.phone,
          source: h.source,
        })),
      };
    },
  });
}
