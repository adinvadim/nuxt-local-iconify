import { join } from "pathe";
import {
  defineNuxtModule,
  addPlugin,
  createResolver,
  addTemplate,
  useNuxt,
  useLogger,
} from "@nuxt/kit";

import { mkdirp } from "mkdirp";
import {
  importDirectory,
  cleanupSVG,
  runSVGO,
  parseColors,
  isEmptyColor,
} from "@iconify/tools";

export interface ModuleOptions {
  iconPath: string;
  prefix: string;
}

const defaults = (nuxt = useNuxt()): ModuleOptions => ({
  iconPath: join(nuxt.options.dir.assets, "icons"),
  prefix: "local",
});

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: "nuxt-local-iconify",
    configKey: "localIconify",
  },
  defaults,
  async setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url);
    const logger = useLogger("nuxt-local-iconify");

    addPlugin(resolve("./runtime/plugin"));

    await Promise.all([
      mkdirp(resolve(nuxt.options.rootDir, options.iconPath)),
      mkdirp(resolve(nuxt.options.rootDir, options.iconPath, "./monotone/")),
      mkdirp(resolve(nuxt.options.rootDir, options.iconPath, "./color/")),
    ]);

    const monotoneIconSet = await importDirectory(
      resolve(nuxt.options.rootDir, options.iconPath, "./monotone/"),
      {
        prefix: options.prefix,
      }
    );

    // Validate, clean up, fix palette and optimise
    await monotoneIconSet.forEach(async (name, type) => {
      if (type !== "icon") {
        return;
      }

      const svg = monotoneIconSet.toSVG(name);
      if (!svg) {
        // Invalid icon
        monotoneIconSet.remove(name);
        return;
      }

      // Clean up and optimise icons
      try {
        // Clean up icon code
        await cleanupSVG(svg);

        // Assume icon is monotone: replace color with currentColor, add if missing
        // If icon is not monotone, remove this code
        await parseColors(svg, {
          defaultColor: "currentColor",
          callback: (_attr, colorStr, color) => {
            return !color || isEmptyColor(color) ? colorStr : "currentColor";
          },
        });

        // Optimise
        runSVGO(svg);
      } catch (err) {
        // Invalid icon
        logger.error(`Error parsing ${name}:`, err);
        monotoneIconSet.remove(name);
        return;
      }

      // Update icon
      monotoneIconSet.fromSVG(name, svg);
    });

    const colorIconSet = await importDirectory(
      resolve(nuxt.options.rootDir, options.iconPath, "./color/"),
      {
        prefix: `${options.prefix}-color`,
        ignoreImportErrors: true,
      }
    );

    // Validate, clean up, fix palette and optimise
    await colorIconSet.forEach(async (name, type) => {
      if (type !== "icon") {
        return;
      }

      const svg = colorIconSet.toSVG(name);
      if (!svg) {
        // Invalid icon
        colorIconSet.remove(name);
        return;
      }

      // Clean up and optimise icons
      try {
        // Clean up icon code
        await cleanupSVG(svg);

        runSVGO(svg);
      } catch (err) {
        // Invalid icon
        logger.error(`Error parsing ${name}:`, err);
        colorIconSet.remove(name);
        return;
      }

      // Update icon
      colorIconSet.fromSVG(name, svg);
    });

    // Export as IconifyJSON
    const exported =
      JSON.stringify(monotoneIconSet.export(), null, "\t") + "\n";

    const colorExported =
      JSON.stringify(colorIconSet.export(), null, "\t") + "\n";

    const template = addTemplate({
      filename: "nuxt-local-iconify.mjs",
      getContents: () =>
        `export const AppIconJson = ${exported};

export const AppIconColorJson = ${colorExported};
        `,
      write: true,
    });

    nuxt.options.alias["#nuxt-local-iconify"] = template.dst;

    nuxt.hook("build:done", () => {
      if (monotoneIconSet.count() > 0) {
        logger.success("Loaded monotone icons:", monotoneIconSet.count());
      }
      if (colorIconSet.count() > 0) {
        logger.success("Loaded color icons:", colorIconSet.count());
      }
    });
  },
});
