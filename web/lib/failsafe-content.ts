/**
 * Offline-survival content.
 *
 * Every value in this file is bundled into the JS — no network, no API key,
 * no Sarvam, no Claude required to render any of it. When the agent or the
 * network is unreachable, this is what the bystander sees.
 *
 * Two design rules:
 *  1. **Tel: links work without internet.** The OS dials the moment the user
 *     taps. So every "do something" affordance in failsafe mode is a tel:
 *     link, not an API call.
 *  2. **First-aid steps are universal.** Not medical advice — these are the
 *     basics any first-aid course (Red Cross, AHA, St. John) teaches, in
 *     plain language the bystander can follow under stress.
 */
export interface FailsafeHospital {
  name: string;
  phone: string;
  /** Short, human-readable note: "Level I Trauma · cath lab". */
  note: string;
  /** Coarse region — used to pick which list to show. */
  region: "peoria" | "bangalore";
}

export const FAILSAFE_HOSPITALS: FailsafeHospital[] = [
  // Peoria region — verified from peoria.json seed.
  {
    name: "OSF Saint Francis (Peoria)",
    phone: "+1-309-655-2000",
    note: "Level I Trauma · cath lab · stroke",
    region: "peoria",
  },
  {
    name: "UnityPoint Methodist (Peoria)",
    phone: "+1-309-672-5522",
    note: "Cath lab · stroke",
    region: "peoria",
  },
  {
    name: "OSF Children's Hospital",
    phone: "+1-309-655-2000",
    note: "Pediatric trauma · NICU",
    region: "peoria",
  },
  // Bangalore region — placeholders for the next demo.
  {
    name: "Apollo Hospital (Bannerghatta)",
    phone: "+91-80-2630-4050",
    note: "Multi-specialty · cardiac",
    region: "bangalore",
  },
  {
    name: "Manipal Hospital (Old Airport Rd)",
    phone: "+91-80-2502-4444",
    note: "Multi-specialty · trauma",
    region: "bangalore",
  },
];

export interface FirstAidStep {
  title: string;
  /** Detection cue — when to pick this protocol. */
  when: string;
  steps: string[];
}

export const UNIVERSAL_FIRST_AID: FirstAidStep[] = [
  {
    title: "Not breathing / no pulse",
    when: "Adult is unresponsive and not breathing normally",
    steps: [
      "Lay them flat on their back on a hard surface.",
      "Place the heel of one hand in the center of the chest, between the nipples.",
      "Push HARD and FAST — about 2 inches deep, 100–120 times per minute.",
      "Count out loud: \"1 and 2 and 3 and 4…\" — the beat of \"Stayin' Alive.\"",
      "Do NOT stop until help arrives or they start breathing.",
    ],
  },
  {
    title: "Severe bleeding",
    when: "Blood is soaking through clothing or pooling on the ground",
    steps: [
      "Press hard on the wound with a clean cloth or shirt — DO NOT lift to check.",
      "Keep pressing for at least 10 minutes without letting up.",
      "If blood soaks through, add more cloth on top — do not remove what's there.",
      "If a limb is bleeding badly, raise it above the heart while pressing.",
      "Stay with the person and keep them warm — talk to them.",
    ],
  },
  {
    title: "Chest pain (suspected heart attack)",
    when: "Crushing chest pain, sweating, pain radiating to arm or jaw",
    steps: [
      "Have them sit down and stay still — do NOT let them walk.",
      "If they are awake and not allergic, give 1 adult aspirin (325 mg) to chew.",
      "Loosen tight clothing around the neck and chest.",
      "Stay with them. If they pass out and stop breathing → start CPR.",
      "Note the time pain started — tell the responder when they arrive.",
    ],
  },
  {
    title: "Choking",
    when: "Cannot speak, breathe, or cough — clutching the throat",
    steps: [
      "Stand behind them. Wrap your arms around their waist.",
      "Make a fist with one hand just above the belly button.",
      "Grasp your fist with the other hand. Pull sharply IN and UP.",
      "Repeat until the object comes out or they become unresponsive.",
      "If they go unconscious → lower them to the floor and start CPR.",
    ],
  },
  {
    title: "Stroke",
    when: "Face drooping, arm weakness, slurred speech — sudden onset",
    steps: [
      "Note the time symptoms started — this is critical for treatment.",
      "Have them lie down with their head slightly raised.",
      "Do NOT give them food, water, or medication.",
      "Loosen tight clothing. Stay calm and reassure them.",
      "If they vomit or become unconscious, roll them onto their side.",
    ],
  },
];

/**
 * Emergency number for the user's region.
 *
 * We pick by `DEFAULT_COUNTRY_CODE` — same env that drives WhatsApp phone
 * normalization. The wrapper is `tel:` so the OS dialer takes over the moment
 * the user taps; no app code runs after that, which is exactly what we want
 * when the rest of the app may be in a degraded state.
 */
export interface EmergencyNumber {
  display: string;
  tel: string;
  region: "peoria" | "bangalore";
}

export function emergencyNumberFor(countryCode: string): EmergencyNumber {
  if (countryCode === "91" || countryCode === "+91") {
    return { display: "108", tel: "tel:108", region: "bangalore" };
  }
  // Default US — Peoria demo.
  return { display: "911", tel: "tel:911", region: "peoria" };
}
