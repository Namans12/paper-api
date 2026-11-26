const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export function newSheetId(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
  return id;
}
