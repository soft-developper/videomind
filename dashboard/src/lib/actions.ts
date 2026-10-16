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
  admin_invited: "Invited an admin", invite_cancelled: "Cancelled an invitation", invite_accepted: "Accepted an invitation", admin_removed: "Removed an admin",
  password_changed: "Changed the password", authenticator_changed: "Changed the authenticator", recovery_codes_renewed: "Made new recovery codes",
};
export const actionLabel = (a: string) => ACTIONS[a] ?? a.replace(/_/g, " ");

/** The features the usage ledger records, in the site's words. */
export const FEATURES: Record<string, string> = {
  transcribe: "Transcription", analyze: "Chapters and summary", embed: "Search passages", search: "Search", ask: "Ask",
  learn_paths: "Learning paths", learn_ask: "Learn questions", live_captions: "Live captions", storage: "Storage", unattributed: "Not attributed",
};
export const featureLabel = (f: string) => FEATURES[f] ?? f.replace(/_/g, " ");
