import type { SFCDescriptor } from "@vue/compiler-sfc";
import { DEFAULT_MAX_COMPONENT_LINES } from "../constants.js";
import type { ScanContext } from "../types.js";

export const scanSfcStructure = (descriptor: SFCDescriptor, context: ScanContext): void => {
  const maxLines = context.config.maxComponentLines ?? DEFAULT_MAX_COMPONENT_LINES;
  const totalLines = context.source.split(/\r?\n/).length;
  if (totalLines > maxLines) {
    context.report({
      rule: "no-large-component",
      severity: "warning",
      category: "Architecture",
      message: `This component is ${totalLines} lines long.`,
      help: `Keep SFCs below ${maxLines} lines by extracting child components or composables.`,
      line: 1,
      column: 1,
    });
  }

  for (const style of descriptor.styles) {
    if (style.scoped || style.module) continue;
    const content = style.content.trim();
    if (content.length === 0) continue;
    const isClearlyGlobal = /^(?::root|html|body|@font-face|@layer|@tailwind)\b/.test(content);
    if (isClearlyGlobal) continue;

    context.report({
      rule: "prefer-scoped-style",
      severity: "warning",
      category: "Maintainability",
      message: "SFC style block is global.",
      help: "Add scoped/module, or move intentional global CSS to a dedicated global stylesheet.",
      line: style.loc.start.line,
      column: style.loc.start.column,
    });
  }
};
