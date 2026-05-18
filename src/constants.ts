export const VERSION = "0.2.0";

export const PLUGIN_NAME = "vue-doctor";

export const CONFIG_FILENAMES = ["vue-doctor.config.json", ".vue-doctorrc.json"];

export const IGNORE_FILENAMES = [
  ".gitignore",
  ".eslintignore",
  ".prettierignore",
  ".vue-doctorignore",
];

export const DEFAULT_IGNORES = [
  ".git/**",
  ".nuxt/**",
  ".output/**",
  ".vitepress/cache/**",
  "coverage/**",
  "dist/**",
  "node_modules/**",
  "storybook-static/**",
];

export const SOURCE_EXTENSIONS = new Set([
  ".vue",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".mts",
  ".cjs",
  ".cts",
]);

export const SCORE_GOOD_THRESHOLD = 75;
export const SCORE_OK_THRESHOLD = 50;

export const DEFAULT_MAX_COMPONENT_LINES = 350;
export const DEFAULT_MAX_PROPS = 14;
export const DEFAULT_FAIL_ON = "error";
