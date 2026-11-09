declare namespace Cloudflare {
  interface Env {
    /** Secret: Claude API key. */
    ANTHROPIC_API_KEY?: string
    /** Secret: the browser extension's bearer token. */
    EXTENSION_TOKEN?: string
    /** Secrets for the morning digest on Telegram. Optional. */
    TELEGRAM_BOT_TOKEN?: string
    TELEGRAM_CHAT_ID?: string
  }
}

declare namespace App {
  interface Locals {
    /** Who is signed in through Cloudflare Access, or "local" in development. */
    user?: string
  }
}
