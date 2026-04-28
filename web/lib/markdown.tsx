import React from "react";

/**
 * Tiny inline-markdown renderer.
 * Handles **bold**, *italic*, `code`, and line breaks. No deps.
 */
export function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, i) => (
    <React.Fragment key={i}>
      {renderLine(line)}
      {i < lines.length - 1 && <br />}
    </React.Fragment>
  ));
}

function renderLine(line: string): React.ReactNode {
  // Tokenize: bold (**), italic (*), inline code (`)
  const tokens: { type: "text" | "bold" | "italic" | "code"; value: string }[] = [];
  let i = 0;
  let buf = "";
  const flush = () => {
    if (buf) tokens.push({ type: "text", value: buf });
    buf = "";
  };

  while (i < line.length) {
    if (line.startsWith("**", i)) {
      const end = line.indexOf("**", i + 2);
      if (end !== -1) {
        flush();
        tokens.push({ type: "bold", value: line.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (line[i] === "`") {
      const end = line.indexOf("`", i + 1);
      if (end !== -1) {
        flush();
        tokens.push({ type: "code", value: line.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (line[i] === "*" && line[i + 1] !== "*") {
      const end = line.indexOf("*", i + 1);
      if (end !== -1) {
        flush();
        tokens.push({ type: "italic", value: line.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    buf += line[i];
    i++;
  }
  flush();

  return tokens.map((t, k) => {
    if (t.type === "bold") return <strong key={k}>{t.value}</strong>;
    if (t.type === "italic") return <em key={k}>{t.value}</em>;
    if (t.type === "code")
      return (
        <code key={k} className="px-1 py-0.5 rounded bg-white/10 text-xs font-mono">
          {t.value}
        </code>
      );
    return <React.Fragment key={k}>{t.value}</React.Fragment>;
  });
}
