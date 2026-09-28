import type { Messages } from './en'

export const ja: Messages = {
  meta: {
    localeName: '日本語',
    htmlLang: 'ja',
  },
  nav: {
    signIn: 'ログイン',
    signOut: 'ログアウト',
    sessionStale: 'セッション期限切れ',
    dev: 'dev',
    notSignedIn: '未ログイン',
    theme: 'テーマ',
    themeAuto: '自動',
    themeLight: 'ライト',
    themeDark: 'ダーク',
  },
  app: {
    settingsComingSoon: '設定機能は近日公開予定です。',
    notFound: 'ページが見つかりませんでした。',
  },
  errors: {
    badRequest: 'リクエストが正しくありません。',
    unauthorized: 'ログインが必要です。',
    sessionStale: 'セッションが受け付けられません。ログアウトしてから入り直してください。',
    notFound: '見つかりませんでした。',
    conflict: '現在の状態と競合しています。',
    payloadTooLarge: 'サイズが大きすぎます。',
    unsupportedMediaType: 'このファイル形式には対応していません。',
    badGateway: 'アップストリームサーバーが応答しませんでした。',
    internalError: '問題が発生しました。',
  },
}
