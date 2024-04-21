import { addCollection } from "@iconify/vue";

import { AppIconColorJson, AppIconJson } from "#nuxt-local-iconify";
import { defineNuxtPlugin } from "#app";

export default defineNuxtPlugin((_nuxtApp) => {
  if (AppIconJson != null) {
    addCollection(AppIconJson);
  }
  if (AppIconColorJson != null) {
    addCollection(AppIconColorJson);
  }
});
