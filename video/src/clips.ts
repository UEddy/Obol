/**
 * Real screen recordings go in video/public/clips/ and are listed here.
 * Leave an entry null to render a labelled placeholder instead (for previewing the edit).
 *
 * Record at 1920x1080 (or 2560x1440), 30 fps, browser zoom ~110%, dark desktop hidden.
 */
export type Clip = { file: string | null; startSeconds?: number; what: string };

export const CLIPS: Record<"chat" | "pay" | "dashboard", Clip> = {
  chat: {
    file: null, // e.g. "clips/chat.mp4"
    what: "Hermes chat: 'Invoice billing@acme.test $1,200 for October consulting and send it' → approval prompt → Approve → payment link",
  },
  pay: {
    file: null, // e.g. "clips/pay.mp4"
    what: "Open the payment link → Stripe test checkout → card 4242 4242 4242 4242 → Paid. Then ask Hermes 'Has Acme paid?'",
  },
  dashboard: {
    file: null, // e.g. "clips/dashboard.mp4"
    what: "Hermes dashboard → Invoices tab → Sync → the Acme card flips to a PAID stamp; scroll to the ledger",
  },
};
