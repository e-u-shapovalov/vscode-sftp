import { getUserSetting } from './host';
import { EXTENSION_NAME, SETTING_ALERT_LANGUAGE } from './constants';

export type Lang = 'en' | 'ru';

// WireFerry's popup/prompt language is an explicit setting, deliberately decoupled from the VS Code
// display language: a user can run an English UI but want Russian alerts (or vice versa). Defaults
// to English.
//
// Cached, because L() is not only called for popups: tooltips and file decorations run it several
// times per visible tree row, and re-reading the configuration for each one made a 500-row folder
// cost thousands of lookups. Flipping the setting still takes effect without a reload — the cache is
// dropped from the configuration-change subscription in modules/ext.
let cachedLang: Lang | undefined;

export function getAlertLang(): Lang {
  if (cachedLang === undefined) {
    const value = getUserSetting(EXTENSION_NAME).get<string>(SETTING_ALERT_LANGUAGE, 'en');
    cachedLang = value === 'ru' ? 'ru' : 'en';
  }
  return cachedLang;
}

export function invalidateAlertLangCache(): void {
  cachedLang = undefined;
}

// Pick the message variant for the current alert language. Used at every point we show text to the
// user (notifications, prompts, quick-pick placeholders, progress titles, report tabs).
export function L(messages: { en: string; ru: string }): string {
  return messages[getAlertLang()];
}
