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
});
