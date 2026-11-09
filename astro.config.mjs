// @ts-check
import cloudflare from '@astrojs/cloudflare'
import vue from '@astrojs/vue'
import { defineConfig } from 'astro/config'

// Everything renders on demand: this is a private dashboard behind Cloudflare Access, not a public site.
export default defineConfig({
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [vue()],
  session: false,
  // The middleware checks origins itself and lets the extension's bearer-token API through.
  security: { checkOrigin: false },
  devToolbar: { enabled: false },
  prefetch: false,
})
