/**
 * Quick-reply parsing for the dispatcher's clarifying questions.
 *
 * The agent ends a clarifying-question message with a machine-readable line:
 *
 *   Is the leg bleeding?
 *   OPTIONS: Heavily | A little | None
 *
 * The UI turns the OPTIONS line into tappable chips so a panicked caller (or a
 * literate bystander) can answer with one tap instead of speaking a sentence
 * and waiting for it to transcribe. We strip the OPTIONS line everywhere the
 * prose is shown, spoken (TTS), or translated so it's never read aloud.
 */

export interface ParsedReply {
  /** The message with the OPTIONS line removed — safe to display/speak/translate. */
  cleanText: string;
  /** Parsed tap options (2–4), empty when the message isn't a question. */
  options: string[];
}

// Capture everything after "OPTIONS:" on its line; tolerate markdown emphasis
// the model sometimes adds (e.g. "**OPTIONS:**").
const CAPTURE_RE = /OPTIONS\s*:\s*(.+)$/im;
// Match the entire line containing OPTIONS: so we can strip it cleanly.
const LINE_RE = /^[^\n]*OPTIONS\s*:[^\n]*$/im;

export function parseQuickReplies(text: string): ParsedReply {
  if (!text) return { cleanText: text, options: [] };
  const cap = text.match(CAPTURE_RE);
  if (!cap) return { cleanText: text, options: [] };

  const options = cap[1]
    .replace(/\*\*/g, "")
    .split("|")
    .map((s) => s.replace(/[*_`]/g, "").trim())
    .filter(Boolean)
    .slice(0, 4);

  const cleanText = text
    .replace(LINE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

  return { cleanText, options };
}
