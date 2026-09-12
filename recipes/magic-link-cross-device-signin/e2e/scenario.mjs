// SSO-3048 (epic SSO-3046) — declared scenario metadata for `magic-link-cross-device-signin`.
// ONE source of truth for the journey's step titles (imported by the spec + the results reporter).

export const STEPS = {
  request:
    "Device A requests a passwordless sign-in link (sets the ML_INIT initiating-device cookie)",
  capture:
    "Capture the single-use magic link from the sandbox test inbox (channel magic_link)",
  otherDevice:
    "Device B (no ML_INIT) opens the link → NOT signed in → shows a continuation code",
  redeem:
    "Redeem the code on Device A (the initiator) → sign-in completes → /protected",
};

export const scenario = {
  id: "magic-link-cross-device-signin",
  workflow: ".github/workflows/magic-link-cross-device-e2e.yml",
  title: "Passwordless (magic link), another device: open on B, redeem the code on A",
  summary:
    "Drives the `magic-link-cross-device-signin` recipe's loopback relying party against the staging " +
    "SaaS in a real browser, pointed at a FRESH per-run SANDBOX ENVIRONMENT (env.create), using TWO " +
    "browser contexts as two devices. Device A starts the sign-in and requests a single-use email link " +
    "(identity POST /auth/magic-link/request, which sets A's ML_INIT cookie); the email is captured " +
    "from the per-run sandbox test inbox (channel magic_link). Device B — a different context with NO " +
    "ML_INIT — opens the link and is DELIBERATELY NOT signed in; identity renders a short continuation " +
    "code instead (the SSO-2613 adaptive cross-device flow). Typing that code back on Device A, which " +
    "carries ML_INIT, completes the sign-in there and resumes /oauth2/authorize to the RP. A wrong code " +
    "is rejected. This proves the anti-phishing property: a link opened on another device cannot, by " +
    "itself, complete the sign-in. The sandbox (client + user) is hard-deleted on teardown.",
  steps: [
    { key: "request", title: STEPS.request },
    { key: "capture", title: STEPS.capture },
    { key: "otherDevice", title: STEPS.otherDevice },
    { key: "redeem", title: STEPS.redeem },
  ],
  errorPath: {
    title: "A wrong continuation code is rejected on the initiating device",
  },
  liveConfirm: [
    "The hosted login offers the magic-link affordance (#magicLinkToggle → #magicLinkForm → #magicLinkEmail) — magic-link is default-on.",
    "The sandbox test inbox captures the magic-link on channel `magic_link` with the consume URL as its actionLink.",
    "Opening the link in a SECOND context (no ML_INIT) renders the continuation-code page (`.code`) and does NOT authenticate that device.",
    "Redeeming the code on the initiating device (#magicLinkRedeemForm / #magicLinkCode) completes the sign-in; a wrong code surfaces #magicLinkCodeError.",
  ],
};
