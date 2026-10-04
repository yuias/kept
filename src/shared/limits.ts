export const TITLE_MAX_CHARS = 1000
export const BODY_MAX_BYTES = 512 * 1024 // body + body_plain stay under D1's 2 MB row
export const PREVIEW_CHARS = 300
export const PAGE_SIZE_DEFAULT = 50
export const PAGE_SIZE_MAX = 100

export const LABEL_MAX_CHARS = 64
export const LABELS_PER_NOTE_MAX = 32

export const FOLDER_NAME_MAX_CHARS = 100
export const FOLDER_DEPTH_MAX = 8 // a root-level folder has depth 1

export const SEARCH_QUERY_MAX_CHARS = 1000
export const SEARCH_ATOMS_MAX = 16
export const SEARCH_ATOM_MAX_CHARS = 200 // 16*2 params < 100

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const IMAGE_MAX_EDGE = 2560
export const IMAGE_WEBP_QUALITY = 80
export const WEBP_MAX_DIMENSION = 16383

export const FETCH_MAX_BYTES = 20 * 1024 * 1024
export const FETCH_TIMEOUT_MS = 10_000
export const FETCH_MAX_REDIRECTS = 3

export const REGEX_SOURCE_MAX_CHARS = 200
export const REGEX_SCAN_ROWS_MAX = 2000
export const REGEX_SCAN_CHARS_MAX = 4_000_000
// Bounds the text one regex test sees, since the scan guards cap only the total.
export const REGEX_ROW_CHARS_MAX = 20_000
export const REGEX_SCAN_BATCH_SIZE = 200

export const CARD_IMAGES_MAX = 4
// Slice of `body`, starting at the first `![`, scanned for card images.
export const IMAGE_HEAD_CHARS = 2000

export const LINK_PREVIEW_URL_MAX_CHARS = 2048
export const LINK_PREVIEW_MAX_BYTES = 512 * 1024 // HTML read before giving up on finding </head>
export const LINK_PREVIEW_TIMEOUT_MS = 5_000
export const LINK_PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const LINK_PREVIEW_FAILURE_TTL_MS = 60 * 60 * 1000
export const LINK_PREVIEW_TITLE_MAX_CHARS = 300
export const LINK_PREVIEW_DESCRIPTION_MAX_CHARS = 500
export const LINK_PREVIEW_SITE_NAME_MAX_CHARS = 100
