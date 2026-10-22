// vm_insights: what each audit log action means, in plain words. Shared by
// Overview's recent activity and the audit log in Insights.
export const ACTIONS: Record<string, string> = {
  setup_link_sent: "Setup link sent", set_up: "Dashboard set up", sign_in: "Signed in", sign_out: "Signed out",
  sign_in_failed: "Failed sign in", sign_in_while_locked: "Sign in while locked", locked: "Account locked",
  reset_link_sent: "Password reset link sent", reset_link_unknown_email: "Reset asked for an unknown email", password_reset: "Password changed",
  job_retried: "Ran a job again", upload_discarded: "Discarded an upload", housekeeping_run: "Ran the housekeeping", admin_sessions_ended: "Signed other admin sessions out",
  video_removed: "Took a video down", video_restored: "Restored a video", live_ended: "Ended a live event",
  user_signed_out: "Signed a wallet out", user_suspended: "Suspended a wallet", user_unsuspended: "Lifted a suspension", user_data_deleted: "Deleted a wallet's data",
  price_changed: "Changed a price", fixed_cost_added: "Added a fixed cost", fixed_cost_removed: "Removed a fixed cost",
  credit_price_changed: "Changed a credit price", credit_welcome_changed: "Changed the welcome credits", credits_granted: "Gave credits",
  credits_removed: "Removed credits", credit_refunded: "Refunded a charge",
  charging_turned_on: "Turned charging on", charging_turned_off: "Turned charging off",
  credit_fee_changed: "Changed the platform fee", credit_price_applied: "Applied a suggested price", credit_prices_applied: "Applied the suggested prices",
  credit_estimate_changed: "Changed a cost estimate",
  storage_free_changed: "Changed the free storage", storage_forgiven: "Forgave storage owed",
  generation_settings_changed: "Changed video generation", generation_model_changed: "Changed a generation model",
  generation_allowed: "Allowed a wallet to generate", generation_disallowed: "Removed a wallet from generation",
  admin_invited: "Invited an admin", invite_cancelled: "Cancelled an invitation", invite_accepted: "Accepted an invitation", admin_removed: "Removed an admin",
  password_changed: "Changed the password", authenticator_changed: "Changed the authenticator", recovery_codes_renewed: "Made new recovery codes",
};
export const actionLabel = (a: string) => ACTIONS[a] ?? a.replace(/_/g, " ");

/** The features the usage ledger records, in the site's words. */
export const FEATURES: Record<string, string> = {
  transcribe: "Transcription", analyze: "Chapters and summary", embed: "Search passages", search: "Search", ask: "Ask",
  learn_paths: "Learning paths", learn_ask: "Learn questions", live_captions: "Live captions", storage: "Storage", generate_direct: "Generation descriptions", translate: "Translation", unattributed: "Not attributed",
};
export const featureLabel = (f: string) => FEATURES[f] ?? f.replace(/_/g, " ");

/** vm_credits: money as the dashboard shows it. Credits are counted in micro dollars. */
export function dollars(micros: number, exact = false): string {
  const x = micros / 1_000_000;
  if (!exact && x !== 0 && Math.abs(x) < 0.01) return x < 0 ? "-under $0.01" : "under $0.01";
  return x.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: exact ? 6 : 2 });
}
export const CREDIT_KINDS: Record<string, string> = {
  welcome: "Welcome", grant: "Given by an admin", remove: "Removed by an admin", topup: "Top up", charge: "Charge", refund: "Refund",
};
export const CREDIT_UNITS: Record<string, string> = { minute: "per minute", answer: "per answer", search: "per search", generation: "per generation", gb_month: "per GB month", second: "per second" };
