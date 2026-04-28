import { promises as fs } from "node:fs";
import path from "node:path";

interface SeedHospital {
  name: string;
  address: string;
  lat: number;
  lng: number;
  capabilities: string[];
  phone?: string;
  city?: string;
}

interface RawSeedRow {
  name: string;
  city?: string;
  address?: string;
  lat?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
  location?: { lat: number; lng: number };
  capabilities?: string[];
  phone?: string;
  emergency_contact?: string;
  whatsapp_number?: string;
}

const REGIONS = ["bangalore.json", "peoria.json"];

let cache: SeedHospital[] | null = null;

/** Load all region seed files from /data/hospitals. Cached after first read. */
export async function loadSeedHospitals(): Promise<SeedHospital[]> {
  if (cache) return cache;

  const baseCandidates = [
    path.join(process.cwd(), "..", "data", "hospitals"),
    path.join(process.cwd(), "data", "hospitals"),
  ];

  const merged: SeedHospital[] = [];

  for (const region of REGIONS) {
    let loaded = false;
    for (const base of baseCandidates) {
      const p = path.join(base, region);
      try {
        const raw = await fs.readFile(p, "utf-8");
        const parsed = JSON.parse(raw) as RawSeedRow[] | { hospitals: RawSeedRow[] };
        const list: RawSeedRow[] = Array.isArray(parsed) ? parsed : parsed.hospitals ?? [];

        for (const h of list) {
          merged.push({
            name: h.name,
            city: h.city,
            address: h.address ?? "",
            lat: h.location?.lat ?? h.lat ?? h.latitude ?? 0,
            lng: h.location?.lng ?? h.lng ?? h.longitude ?? 0,
            capabilities: h.capabilities ?? [],
            phone: h.phone ?? h.emergency_contact ?? h.whatsapp_number,
          });
        }
        loaded = true;
        break;
      } catch {
        // try next base path
      }
    }
    if (!loaded) {
      console.warn(`[hospitals-seed] ${region} not found in any candidate path`);
    }
  }

  cache = merged;
  return cache;
}
