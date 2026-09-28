const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const ID_LENGTH = 12

/** Largest multiple of the alphabet size that fits in a byte, for unbiased sampling. */
const REJECTION_LIMIT = Math.floor(256 / ALPHABET.length) * ALPHABET.length

export function generateId(): string {
  let id = ''
  const buffer = new Uint8Array(ID_LENGTH * 2)

  while (id.length < ID_LENGTH) {
    crypto.getRandomValues(buffer)
    for (const byte of buffer) {
      if (byte >= REJECTION_LIMIT) continue
      id += ALPHABET[byte % ALPHABET.length]
      if (id.length === ID_LENGTH) break
    }
  }

  return id
}

const ID_PATTERN = new RegExp(`^[0-9A-Za-z]{${ID_LENGTH}}$`)

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id)
}
