# Nuxt Local Iconify

Nuxt Icon now support local icons. [See](https://github.com/nuxt/icon/issues/19#issuecomment-2091935313).


[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

Module for enjoing iconify and nuxt-icon with your local icons for doing amazing things.

- [✨ &nbsp;Release Notes](/CHANGELOG.md)
  <!-- - [🏀 Online playground](https://stackblitz.com/github/your-org/nuxt-local-iconify?file=playground%2Fapp.vue) -->
  <!-- - [📖 &nbsp;Documentation](https://example.com) -->

## Features

<!-- Highlight some of the features your module provide here -->

- 🩵 Support monotone icons for correct working with currentColor
- 🎨 Support colorized icons
- 🥳 Ready for using with [nuxt-icon](https://github.com/nuxt-modules/icon)

## Quick Setup

Install the module to your Nuxt application with one command:

```bash
npm install --save-dev nuxt-local-iconify

# Using yarn
yarn add --dev nuxt-local-iconify

# Using pnpm
pnpm add --save-dev nuxt-local-iconify
```

```typescript
import { defineNuxtConfig } from "nuxt";

export default defineNuxtConfig({
  modules: [
    "nuxt-icon", // If you use nuxt-icon to work with iconify
    "nuxt-local-iconify",
  ],
});
```

## Example usage with nuxt-icon

Suppose you have an icon in `~/assets/icons/monotone/abc.svg`:

```vue
<Icon name="local:abc" color="red" />
```

Or colorized icon in `~/assets/icons/color/twitch.svg`:

```vue
<Icon name="local-color:twitch" />
```

That's it! You can now use Nuxt Local Iconify in your Nuxt app ✨

## Configuration

By default Nuxt Local Iconify look for icons in `~/assets/icons` directory.
For monoton icons it looks in `~/assets/icons/monotone` and for colorized icons in `~/assets/icons/color`.

You can change this behavior by providing custom configuration with the `localIconify.iconPath` option.

If you want to change iconify prefix you can use `localIconify.prefix` option.
You will get `your-prefix:icon-name` as icon name and `your-prefix-color:icon-name` for color icons.

## Contribution

<details>
  <summary>Local development</summary>

```bash
# Install dependencies
npm install

# Generate type stubs
npm run dev:prepare

# Develop with the playground
npm run dev

# Build the playground
npm run dev:build

# Run ESLint
npm run lint

# Run Vitest
npm run test
npm run test:watch

# Release new version
npm run release
```

</details>

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/nuxt-local-iconify/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/nuxt-local-iconify
[npm-downloads-src]: https://img.shields.io/npm/dm/nuxt-local-iconify.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npmjs.com/package/nuxt-local-iconify
[license-src]: https://img.shields.io/npm/l/nuxt-local-iconify.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/nuxt-local-iconify
[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt.js
[nuxt-href]: https://nuxt.com
