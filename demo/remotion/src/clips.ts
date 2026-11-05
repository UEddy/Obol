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
    what: "Forward Dana's message (12 h at $100/hr, billing@pinemoor.test) → Hermes proposes $1,200.00 → 'send it' → approval prompt with risk checks → Approve → payment link",
  },
  pay: {
    file: null, // e.g. "clips/pay.mp4"
    what: "Open the payment link → Stripe test checkout → card 4242 4242 4242 4242 → Paid. Then ask Hermes 'Has Pinemoor paid?'",
  },
  dashboard: {
    file: null, // e.g. "clips/dashboard.mp4"
    what: "Hermes dashboard → Invoices (TEST MODE badge) → Sync → the Pinemoor row's stamp flips to PAID; Paid total rises by $1,200.00",
  },
};
