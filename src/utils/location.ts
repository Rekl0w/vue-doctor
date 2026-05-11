export interface SourceLocation {
  line: number;
  column: number;
}

export const getLineColumn = (
  source: string,
  index: number,
  lineOffset = 0,
): SourceLocation => {
  const before = source.slice(0, Math.max(0, index));
  const lines = before.split(/\r?\n/);
  return {
    line: lineOffset + lines.length,
    column: lines[lines.length - 1]!.length + 1,
  };
};

export const getLineText = (source: string, oneBasedLine: number): string => {
  const lines = source.split(/\r?\n/);
  return lines[oneBasedLine - 1] ?? "";
};

export const findLineMatches = (
  source: string,
  pattern: RegExp,
  lineOffset = 0,
): Array<SourceLocation & { match: RegExpExecArray }> => {
  const results: Array<SourceLocation & { match: RegExpExecArray }> = [];
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let match: RegExpExecArray | null;

  while ((match = globalPattern.exec(source)) !== null) {
    const location = getLineColumn(source, match.index, lineOffset);
    results.push({ ...location, match });
    if (match[0].length === 0) globalPattern.lastIndex++;
  }

  return results;
};
