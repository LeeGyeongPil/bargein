import { describe, expect, it } from 'vitest';
import { LANGS, STORAGE_KEY, messages, resolveLang, saveLang, t } from '../demo/i18n.js';

describe('demo i18n', () => {
  it('en and ko have the same keys and no empty values', () => {
    expect(Object.keys(messages.ko).sort()).toEqual(Object.keys(messages.en).sort());
    for (const lang of LANGS) for (const [k, v] of Object.entries(messages[lang])) expect(v.trim(), `${lang}.${k}`).not.toBe('');
  });

  it('placeholders match between languages', () => {
    for (const k of Object.keys(messages.en) as Array<keyof typeof messages.en>) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(ph(messages.ko[k])).toBe(ph(messages.en[k]));
    }
  });

  it('resolves ?lang= before the saved value before navigator.language', () => {
    expect(resolveLang({ search: '?lang=ko', stored: 'en', navigatorLanguage: 'en-US' })).toBe('ko');
    expect(resolveLang({ search: '?lang=en', stored: 'ko', navigatorLanguage: 'ko-KR' })).toBe('en');
    expect(resolveLang({ search: '', stored: 'ko', navigatorLanguage: 'en-US' })).toBe('ko');
    expect(resolveLang({ stored: 'en', navigatorLanguage: 'ko-KR' })).toBe('en');
    expect(resolveLang({ navigatorLanguage: 'ko-KR' })).toBe('ko');
    expect(resolveLang({ navigatorLanguage: 'ko' })).toBe('ko');
    expect(resolveLang({ navigatorLanguage: 'fr-FR' })).toBe('en');
    expect(resolveLang({})).toBe('en');
  });

  it('ignores unsupported values', () => {
    expect(resolveLang({ search: '?lang=fr', stored: 'xx', navigatorLanguage: 'ko-KR' })).toBe('ko');
  });

  it('saveLang stores under bargein-demo-lang and the choice is picked up next time', () => {
    const store = new Map<string, string>();
    saveLang({ setItem: (k, v) => void store.set(k, v) }, 'ko');
    expect(STORAGE_KEY).toBe('bargein-demo-lang');
    expect(store.get('bargein-demo-lang')).toBe('ko');
    expect(resolveLang({ stored: store.get(STORAGE_KEY), navigatorLanguage: 'en-US' })).toBe('ko');
  });

  it('switching language changes the text', () => {
    expect(t('en', 'play')).not.toBe(t('ko', 'play'));
    expect(t('ko', 'octaveResult', { hz: 440, ms: 1000 })).toBe('440 Hz, 1000 ms');
  });

  it('has a distinct message for interrupting before any audio started', () => {
    for (const lang of LANGS) expect(messages[lang].needResponse).not.toBe(messages[lang].needGesture);
  });
});
