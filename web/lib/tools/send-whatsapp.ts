import { tool } from "ai";
import { z } from "zod";

type Recipient = "hospital" | "ambulance" | "nurse" | "family" | "other";

interface SendResult {
  sent: boolean;
  recipientType: Recipient;
  to: string;
  sid?: string;
  mocked?: boolean;
  error?: string;
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  // Default country code from env (1 = US, 91 = India). Default US.
  const cc = process.env.DEFAULT_COUNTRY_CODE ?? "1";
  if (digits.length === 10) return `+${cc}${digits}`;
  return `+${digits}`;
}

async function twilioSend(toPhone: string, body: string): Promise<{ sid?: string; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886";

  if (!sid || !token) {
    return { error: "TWILIO not configured" };
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const params = new URLSearchParams({
      From: from,
      To: `whatsapp:${toPhone}`,
      Body: body,
    });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { error: `Twilio HTTP ${res.status}: ${errText}` };
    }

    const data = (await res.json()) as { sid: string };
    return { sid: data.sid };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export const sendWhatsApp = tool({
  description:
    "Send a WhatsApp alert to a single recipient (hospital, ambulance dispatch, on-call nurse, or family). Call this in PARALLEL — multiple invocations in the same response — to fan out to all four parties simultaneously. Falls back to mock-mode (logs only) when Twilio credentials are absent, so it's safe to call in development.",
  inputSchema: z.object({
    recipientType: z
      .enum(["hospital", "ambulance", "nurse", "family", "other"])
      .describe("Who is being notified"),
    recipientName: z.string().describe("Display name of the recipient"),
    recipientPhone: z.string().describe("Phone in any format — will be normalized to E.164"),
    body: z.string().describe("WhatsApp message body. Be concise and structured."),
  }),
  execute: async ({ recipientType, recipientName, recipientPhone, body }): Promise<SendResult & { _card: unknown }> => {
    const intendedTo = normalizePhone(recipientPhone);

    // Demo override: if DEMO_WHATSAPP_OVERRIDE_TO is set, route every dispatch
    // there so a single tester can see all four messages on one phone (Twilio
    // sandbox requires each receiving number to have joined separately).
    const override = process.env.DEMO_WHATSAPP_OVERRIDE_TO?.trim();
    const to = override ? normalizePhone(override) : intendedTo;
    const finalBody = override
      ? `[Demo: → ${recipientType.toUpperCase()} ${recipientName} (${intendedTo})]\n\n${body}`
      : body;

    const { sid, error } = await twilioSend(to, finalBody);

    const result: SendResult =
      sid !== undefined
        ? { sent: true, recipientType, to, sid }
        : error?.includes("TWILIO not configured")
        ? { sent: true, recipientType, to, mocked: true }
        : { sent: false, recipientType, to, error };

    if (result.mocked) {
      console.log(
        `[sendWhatsApp:MOCK] → ${recipientType} (${recipientName} @ ${to})\n${body}\n`
      );
    } else if (result.sent) {
      console.log(`[sendWhatsApp] sent to ${recipientType} ${to} (sid=${result.sid})`);
    } else {
      console.error(`[sendWhatsApp] FAILED to ${recipientType} ${to}: ${result.error}`);
    }

    return {
      ...result,
      _card: {
        type: "whatsapp_dispatch",
        recipientType,
        recipientName,
        to,
        intendedTo: override ? intendedTo : undefined,
        body: finalBody,
        status: result.sent ? (result.mocked ? "mocked" : "sent") : "failed",
        error: result.error,
        sentAt: new Date().toISOString(),
      },
    };
  },
});
