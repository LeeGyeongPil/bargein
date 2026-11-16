// Demo page messages. Keep both languages in this one table.
export type Lang = 'en' | 'ko';
export const STORAGE_KEY = 'bargein-demo-lang';
export const LANGS: Lang[] = ['en', 'ko'];

export const messages = {
  en: {
    title: 'bargein demo: where did the listener stop hearing?',
    mockNotice: 'Practice mock server: audio is synthetic, no API key is used. Point the URL at your own relay to try a real model.',
    language: 'Language',
    wsUrl: 'WebSocket URL',
    connect: 'Connect',
    disconnect: 'Disconnect',
    connected: 'Connected',
    disconnected: 'Not connected',
    play: 'Start response',
    interrupt: 'Interrupt (barge in)',
    stallToggle: 'Simulate a 1.2 s network stall after a 0.5 s burst',
    barReceived: 'Received from server',
    barPlayed: 'Actually played (samples)',
    barWall: 'Wall-clock estimate',
    sentValue: 'Sent audio_end_ms',
    wallValue: 'Wall-clock method would send',
    overReport: 'over-reports by',
    log: 'Event log',
    sent: 'sent',
    received: 'received',
    octaveTitle: 'Octave bug check',
    octaveRun: 'Run check',
    octaveWrong: 'Wrong buffer rate (24 kHz data declared as 48 kHz)',
    octaveRight: 'Correct buffer rate',
    octaveResult: '{hz} Hz, {ms} ms',
    nothingPlaying: 'Nothing was playing.',
    needResponse: 'Click Start response first: nothing has played yet.',
    needGesture: 'Click Connect first: browsers only start audio after a user gesture.',
    ms: 'ms',
  },
  ko: {
    title: 'bargein 데모: 듣던 사람이 어디까지 들었을까?',
    mockNotice: '연습용 목(mock) 서버입니다: 소리는 합성음이고 API 키를 쓰지 않습니다. 실제 모델을 쓰려면 주소를 직접 만든 중계 서버로 바꾸세요.',
    language: '언어',
    wsUrl: 'WebSocket 주소',
    connect: '연결',
    disconnect: '연결 끊기',
    connected: '연결됨',
    disconnected: '연결 안 됨',
    play: '응답 시작',
    interrupt: '끼어들기',
    stallToggle: '0.5초 버스트 뒤 1.2초 네트워크 정체 흉내',
    barReceived: '서버에서 받은 길이',
    barPlayed: '실제로 재생된 길이(샘플 기준)',
    barWall: '벽시계 추정',
    sentValue: '보낸 audio_end_ms',
    wallValue: '벽시계 방식이 보냈을 값',
    overReport: '과대 보고',
    log: '이벤트 로그',
    sent: '보냄',
    received: '받음',
    octaveTitle: '옥타브 버그 확인',
    octaveRun: '확인 실행',
    octaveWrong: '잘못된 버퍼 레이트(24kHz 데이터를 48kHz 로 선언)',
    octaveRight: '올바른 버퍼 레이트',
    octaveResult: '{hz} Hz, {ms} ms',
    nothingPlaying: '재생 중인 소리가 없었습니다.',
    needResponse: '먼저 응답 시작을 누르세요: 아직 재생된 소리가 없습니다.',
    needGesture: '먼저 연결을 누르세요: 브라우저는 사용자 동작 뒤에만 소리를 시작합니다.',
    ms: 'ms',
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type MessageKey = keyof (typeof messages)['en'];

export interface LangInputs {
  /** window.location.search, e.g. "?lang=ko" */
  search?: string;
  /** Value stored under STORAGE_KEY, if any. */
  stored?: string | null;
  /** navigator.language */
  navigatorLanguage?: string;
}

const isLang = (v: unknown): v is Lang => v === 'en' || v === 'ko';

/** Order: ?lang= query, then the saved choice, then the browser language (ko* -> ko, else en). */
export function resolveLang(i: LangInputs): Lang {
  const q = new URLSearchParams(i.search ?? '').get('lang');
  if (isLang(q)) return q;
  if (isLang(i.stored)) return i.stored;
  return (i.navigatorLanguage ?? '').toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export function saveLang(storage: Pick<Storage, 'setItem'>, lang: Lang): void {
  storage.setItem(STORAGE_KEY, lang);
}

export function t(lang: Lang, key: MessageKey, vars: Record<string, string | number> = {}): string {
  return messages[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
