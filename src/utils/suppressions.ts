import { getLineText } from "./location.js";

const normalizeRuleToken = (token: string): string => token.trim().replace(/^vue-doctor\//, "");

const directiveCoversRule = (line: string, marker: string, rule: string): boolean => {
  const markerIndex = line.indexOf(marker);
  if (markerIndex < 0) return false;

  const rawList = line.slice(markerIndex + marker.length).replace(/[*<>{}!]/g, " ");
  const tokens = rawList
    .split(/[,\s]+/)
    .map(normalizeRuleToken)
    .filter(Boolean);

  return tokens.length === 0 || tokens.includes(rule) || tokens.includes("*");
};

export const isSuppressedAtLine = (source: string, line: number, rule: string): boolean => {
  const currentLine = getLineText(source, line);
  if (
    directiveCoversRule(currentLine, "vue-doctor-disable-line", rule) ||
    directiveCoversRule(currentLine, "eslint-disable-line", rule) ||
    directiveCoversRule(currentLine, "oxlint-disable-line", rule)
  ) {
    return true;
  }

  let cursor = line - 1;
  while (cursor >= 1) {
    const text = getLineText(source, cursor).trim();
    if (text.length === 0) break;
    const isComment =
      text.startsWith("//") ||
      text.startsWith("/*") ||
      text.startsWith("*") ||
      text.startsWith("<!--") ||
      text.startsWith("{/*");
    if (!isComment) break;

    if (
      directiveCoversRule(text, "vue-doctor-disable-next-line", rule) ||
      directiveCoversRule(text, "eslint-disable-next-line", rule) ||
      directiveCoversRule(text, "oxlint-disable-next-line", rule)
    ) {
      return true;
    }

    cursor--;
  }

  return false;
};
