import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { diagnose, toJsonReport } from "../src/index.js";

const tempRoots: string[] = [];

const makeProject = (files: Record<string, string>): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vue-doctor-"));
  tempRoots.push(root);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "fixture",
        dependencies: {
          vue: "^3.5.0",
          vite: "^7.0.0",
        },
        devDependencies: {
          typescript: "^5.0.0",
        },
      },
      null,
      2,
    ),
  );

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  return root;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("diagnose", () => {
  it("detects Vue template security, correctness, and accessibility issues", async () => {
    const root = makeProject({
      "src/App.vue": `
<template>
  <article>
    <a href="https://example.com" target="_blank">Docs</a>
    <img src="/logo.png">
    <button><Icon /></button>
    <p v-html="html"></p>
    <div v-for="(item, index) in items" :key="index" v-if="item.visible">
      {{ items.filter(Boolean).length }}
    </div>
  </article>
</template>
<script setup lang="ts">
const props = defineProps({ html: String })
props.html = 'changed'
</script>
<style>
.title { color: red; }
</style>
`,
    });

    const result = await diagnose(root);
    const rules = result.diagnostics.map((diagnostic) => diagnostic.rule);

    expect(rules).toContain("no-target-blank-without-rel");
    expect(rules).toContain("require-img-alt");
    expect(rules).toContain("require-button-name");
    expect(rules).toContain("no-v-html");
    expect(rules).toContain("no-index-key");
    expect(rules).toContain("no-v-if-with-v-for");
    expect(rules).toContain("no-expensive-template-expression");
    expect(rules).toContain("no-mutating-props");
    expect(rules).toContain("prefer-scoped-style");
    expect(result.score.score).toBeLessThan(100);
  });

  it("returns a clean score for a small healthy SFC", async () => {
    const root = makeProject({
      "src/App.vue": `
<template>
  <ul>
    <li v-for="item in items" :key="item.id">{{ item.name }}</li>
  </ul>
</template>
<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ items: Array<{ id: string; name: string }> }>()
const items = computed(() => props.items)
</script>
<style scoped>
li { list-style: none; }
</style>
`,
    });

    const result = await diagnose(root);
    expect(result.diagnostics).toEqual([]);
    expect(result.score.score).toBe(100);
    expect(result.project.framework).toBe("vite");
  });

  it("honors config ignores and inline suppressions", async () => {
    const root = makeProject({
      "vue-doctor.config.json": JSON.stringify({
        ignore: {
          rules: ["vue-doctor/prefer-scoped-style"],
        },
      }),
      "src/App.vue": `
<template>
  <!-- vue-doctor-disable-next-line vue-doctor/no-v-html -->
  <div v-html="trusted"></div>
</template>
<script setup>
const trusted = '<strong>ok</strong>'
</script>
<style>
.global { color: blue; }
</style>
`,
    });

    const result = await diagnose(root);
    expect(result.diagnostics.map((diagnostic) => diagnostic.rule)).toEqual([]);
  });

  it("does not treat event handler assignments as template side effects", async () => {
    const root = makeProject({
      "src/App.vue": `
<template>
  <button @click="open = true">Open</button>
</template>
<script setup>
import { ref } from 'vue'
const open = ref(false)
</script>
`,
    });

    const result = await diagnose(root);
    expect(result.diagnostics.map((diagnostic) => diagnostic.rule)).not.toContain(
      "no-template-side-effects",
    );
  });

  it("does not treat prop comparisons as prop mutations", async () => {
    const root = makeProject({
      "src/App.vue": `
<template>
  <p>{{ isUpdate }}</p>
</template>
<script setup>
const props = defineProps({ actionType: String })
const isUpdate = props.actionType === 'UPDATE'
</script>
`,
    });

    const result = await diagnose(root);
    expect(result.diagnostics.map((diagnostic) => diagnostic.rule)).not.toContain(
      "no-mutating-props",
    );
  });

  it("does not treat CSS custom property names inside strings as template side effects", async () => {
    const root = makeProject({
      "src/App.vue": `
<template>
  <div :style="{ color: active ? 'var(--text-color)' : palette['500'] }" />
</template>
<script setup>
const active = true
const palette = { 500: '#fff' }
</script>
`,
    });

    const result = await diagnose(root);
    expect(result.diagnostics.map((diagnostic) => diagnostic.rule)).not.toContain(
      "no-template-side-effects",
    );
  });

  it("does not treat function refs as template side effects", async () => {
    const root = makeProject({
      "src/App.vue": `
<template>
  <Child v-for="(item, index) in items" :key="item.id" :ref="el => refs[index] = el" />
</template>
<script setup>
const items = [{ id: 1 }]
const refs = []
</script>
`,
    });

    const result = await diagnose(root);
    expect(result.diagnostics.map((diagnostic) => diagnostic.rule)).not.toContain(
      "no-template-side-effects",
    );
  });

  it("handles common safe template edge cases without noisy diagnostics", async () => {
    const root = makeProject({
      "src/App.vue": `
<template>
  <ul>
    <li v-for="(item, idx) in items" :key="idx">{{ item.name }}</li>
  </ul>
  <a href="https://example.com" target="_blank" :rel="'noopener noreferrer'">Docs</a>
  <button><span class="sr-only">Close</span><Icon /></button>
</template>
<script setup>
const items = [{ name: 'Docs' }]
</script>
`,
    });

    const result = await diagnose(root);
    const rules = result.diagnostics.map((diagnostic) => diagnostic.rule);

    expect(rules).toContain("no-index-key");
    expect(rules).not.toContain("no-target-blank-without-rel");
    expect(rules).not.toContain("require-button-name");
  });

  it("does not scan strings, regex literals, or rule title maps as runtime code", async () => {
    const root = makeProject({
      "src/rules.ts": `
const examples = {
  "no-hardcoded-secret": "Hardcoded secret",
  fixture: \`
    import _ from 'lodash'
    props.html = 'changed'
  \`
}
const evalPattern = /\\beval\\s*\\(/g
`,
    });

    const result = await diagnose(root);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat a props field named filters as the Vue 2 filters option", async () => {
    const root = makeProject({
      "src/App.vue": `
<template>
  <p>{{ filters.length }}</p>
</template>
<script setup>
const props = defineProps({
  filters: {
    type: Array,
    default: () => []
  }
})
const filters = props.filters
</script>
`,
    });

    const result = await diagnose(root);
    expect(result.diagnostics.map((diagnostic) => diagnostic.rule)).not.toContain(
      "no-vue2-deprecated-api",
    );
  });

  it("builds a stable JSON report shape", async () => {
    const root = makeProject({
      "src/App.vue": `
<template>
  <img src="/logo.png">
</template>
`,
    });

    const result = await diagnose(root);
    const report = toJsonReport(root, result);

    expect(report.schemaVersion).toBe(1);
    expect(report.ok).toBe(true);
    expect(report.summary.totalDiagnosticCount).toBe(1);
    expect(report.diagnostics[0]?.rule).toBe("require-img-alt");
  });

  it("detects bundle-size, design, and style-performance issues", async () => {
    const root = makeProject({
      "src/App.vue": `
<template>
  <meta name="viewport" content="width=device-width, maximum-scale=1">
</template>
<script setup>
import _ from 'lodash'
import moment from 'moment'
import * as monaco from 'monaco-editor'
</script>
<style scoped>
.panel {
  transition: all 200ms ease;
  will-change: transform;
  outline: none;
  font-size: 10px;
  letter-spacing: -0.02em;
  z-index: 9999;
  background: #000;
  background-image: linear-gradient(red, blue);
  background-clip: text;
}
</style>
`,
    });

    const result = await diagnose(root);
    const rules = result.diagnostics.map((diagnostic) => diagnostic.rule);

    expect(rules).toContain("no-disabled-zoom");
    expect(rules).toContain("no-full-lodash-import");
    expect(rules).toContain("no-moment");
    expect(rules).toContain("prefer-dynamic-import");
    expect(rules).toContain("no-transition-all");
    expect(rules).toContain("no-permanent-will-change");
    expect(rules).toContain("no-outline-none");
    expect(rules).toContain("no-tiny-text");
    expect(rules).toContain("no-wide-letter-spacing");
    expect(rules).toContain("no-z-index-9999");
    expect(rules).toContain("no-pure-black-background");
    expect(rules).toContain("no-gradient-text");
  });

  it("detects Vue and Nuxt-specific runtime risks", async () => {
    const root = makeProject({
      "package.json": JSON.stringify({
        dependencies: {
          nuxt: "^4.0.0",
          vue: "^3.5.0",
        },
      }),
      "nuxt.config.ts": `
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      apiToken: 'visible-to-client'
    }
  }
})
`,
      "src/App.vue": `
<template>
  <p>{{ Math.random() }}</p>
</template>
`,
      "src/client.ts": `
const width = window.innerWidth
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {})
}
`,
    });

    const result = await diagnose(root);
    const rules = result.diagnostics.map((diagnostic) => diagnostic.rule);

    expect(rules).toContain("no-public-runtime-secret");
    expect(rules).toContain("no-hydration-unstable-template");
    expect(rules).toContain("no-ssr-browser-global");
    expect(rules.filter((rule) => rule === "no-ssr-browser-global")).toHaveLength(1);
  });

  it("honors category-level config overrides", async () => {
    const root = makeProject({
      "vue-doctor.config.json": JSON.stringify({
        categories: {
          Design: "off",
          "Bundle Size": "error",
        },
      }),
      "src/App.vue": `
<script setup>
import _ from 'lodash'
</script>
<style scoped>
.button { outline: none; }
</style>
`,
    });

    const result = await diagnose(root);

    expect(result.diagnostics.map((diagnostic) => diagnostic.rule)).not.toContain("no-outline-none");
    expect(result.diagnostics.find((diagnostic) => diagnostic.rule === "no-full-lodash-import")?.severity).toBe("error");
  });

  it("applies rule presets before explicit overrides", async () => {
    const root = makeProject({
      "src/App.vue": `
<template>
  <img src="/logo.png">
</template>
<script setup>
import _ from 'lodash'
</script>
<style scoped>
.button { outline: none; }
</style>
`,
    });

    const strictResult = await diagnose(root, { config: { preset: "strict" } });
    expect(strictResult.diagnostics.find((diagnostic) => diagnostic.rule === "require-img-alt")?.severity).toBe("error");

    const designResult = await diagnose(root, {
      config: {
        preset: "design",
        rules: {
          "vue-doctor/no-full-lodash-import": "warning",
        },
      },
    });
    const designRules = designResult.diagnostics.map((diagnostic) => diagnostic.rule);
    expect(designRules).toContain("no-outline-none");
    expect(designRules).toContain("no-full-lodash-import");
  });
});
