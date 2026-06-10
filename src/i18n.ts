import { getUserSetting } from './host';
import { EXTENSION_NAME, SETTING_ALERT_LANGUAGE } from './constants';

export type Lang = 'en' | 'ru';

// WireFerry's popup/prompt language is an explicit setting, deliberately decoupled from the VS Code
// display language: a user can run an English UI but want Russian alerts (or vice versa). Defaults
// to English. Read fresh on every call so flipping the setting takes effect without a reload.
export function getAlertLang(): Lang {
  const value = getUserSetting(EXTENSION_NAME).get<string>(SETTING_ALERT_LANGUAGE, 'en');
  return value === 'ru' ? 'ru' : 'en';
}

// Pick the message variant for the current alert language. Used at every point we show text to the
// user (notifications, prompts, quick-pick placeholders, progress titles, report tabs).
export function L(messages: { en: string; ru: string }): string {
  return messages[getAlertLang()];
}
