export type IconName =
  | 'pin'
  | 'lock'
  | 'unlock'
  | 'archive'
  | 'unarchive'
  | 'move'
  | 'trash'
  | 'restore'
  | 'deleteForever'
  | 'viewRaw'
  | 'download'
  | 'close'
  | 'copy'
  | 'check'

/** Path data on a 16x16 viewBox, drawn as 1.4px round strokes. */
export const ICON_PATHS: Record<IconName, readonly string[]> = {
  // Same outline as the pinned indicator that used to sit on note cards.
  pin: [
    'M8 1.5a2 2 0 0 1 2 2v3.2l1.8 2.7a.6.6 0 0 1-.5.9H9v3.7a1 1 0 0 1-2 0V10.3H4.7a.6.6 0 0 1-.5-.9L6 6.7V3.5a2 2 0 0 1 2-2Z',
  ],
  lock: ['M3.5 7.5h9v6h-9z', 'M5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5'],
  unlock: ['M3.5 7.5h9v6h-9z', 'M5.5 7.5V5a2.5 2.5 0 0 1 5 0'],
  archive: ['M2 3.5h12v3H2z', 'M3 6.5v6.5h10V6.5', 'M6.5 9h3'],
  unarchive: ['M2 3.5h12v3H2z', 'M3 6.5v6.5h10V6.5', 'M8 12V8.5', 'M6.3 10.2 8 8.5l1.7 1.7'],
  move: ['M1.5 12.5v-9h4.5l1.5 1.5h7v7.5z', 'M5.5 9h5', 'M9 7.5 10.5 9 9 10.5'],
  trash: ['M2.5 4h11', 'M6 4V2.5h4V4', 'M3.8 4l.7 9.5h7l.7-9.5', 'M6.5 6.5v4.5', 'M9.5 6.5v4.5'],
  restore: ['M3 8a5 5 0 1 0 1.5-3.5', 'M3 2.5V5h2.5'],
  deleteForever: [
    'M2.5 4h11',
    'M6 4V2.5h4V4',
    'M3.8 4l.7 9.5h7l.7-9.5',
    'M6.3 7.3l3.4 3.4',
    'M9.7 7.3l-3.4 3.4',
  ],
  viewRaw: ['M5.5 4.5 2 8l3.5 3.5', 'M10.5 4.5 14 8l-3.5 3.5'],
  download: ['M8 2v8', 'M4.5 6.5 8 10l3.5-3.5', 'M2.5 13.5h11'],
  close: ['M3.5 3.5l9 9', 'M12.5 3.5l-9 9'],
  copy: ['M5.5 5.5h8v8h-8z', 'M10.5 5.5v-3h-8v8h3'],
  check: ['M3 8.5l3 3 7-7'],
}
