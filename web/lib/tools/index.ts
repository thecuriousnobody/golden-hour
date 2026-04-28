import type { CallerContext } from "@/lib/types";
import { triagePatient } from "./triage-patient";
import { createFindHospitalsTool } from "./find-hospitals";
import { sendWhatsApp } from "./send-whatsapp";
import { searchWeb } from "./search-web";

/** All tools available to the dispatcher agent. */
export function createTools(caller: CallerContext) {
  return {
    triagePatient,
    findHospitals: createFindHospitalsTool(caller),
    sendWhatsApp,
    searchWeb,
  };
}
