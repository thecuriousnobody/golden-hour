// Shared types across agent + tools + UI

export type Severity = "CRITICAL" | "HIGH" | "MODERATE" | "LOW";

export type Capability =
  | "cath_lab"
  | "ct_scan"
  | "trauma_center"
  | "burn_unit"
  | "icu"
  | "ventilator"
  | "pediatric"
  | "obstetric"
  | "neurosurgery"
  | "orthopedic"
  | "dialysis"
  | "antivenom"
  | "nicu"
  | "blood_bank"
  | "stroke_unit";

export interface CallerContext {
  /** E.164 phone, optional */
  phone?: string;
  name?: string;
  /** Caller / incident location */
  lat: number;
  lng: number;
  /** Original transcript language code (kn, hi, ta, te, en) */
  language: string;
  /** Family / next-of-kin contacts to notify */
  familyContacts?: { name: string; phone: string }[];
}

export interface Symptom {
  key: string; // Emergency, Symptom, Patient, Concern, Urgency
  value: string;
  critical: boolean;
}

export interface TriageResult {
  symptoms: Symptom[];
  likelyCondition: string;
  differentialDiagnoses: string[];
  severity: Severity;
  esiLevel: 1 | 2 | 3 | 4 | 5;
  triageScore: number; // 1-10
  requiredCapabilities: Capability[];
  recommendedFirstAid: string[];
  reasoning: string;
  confidence: number; // 0-1
  timeCriticalityMinutes: number;
  patientDemographics: string;
  disclaimer: string;
}

export interface HospitalMatch {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  distanceKm: number;
  capabilities: Capability[];
  matchedCapabilities: Capability[];
  missingCapabilities: Capability[];
  matchScore: number; // 0-100
  phone?: string;
  source: "google_places" | "seed";
}
