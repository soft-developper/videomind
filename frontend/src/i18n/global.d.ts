// vm_lang: message keys and locales are typed from English, so a key that
// does not exist, or a missing argument, fails the typecheck.
import type en from "../messages/en.json";
import type { Locale } from "./config";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof en;
  }
}
