import type { SearchAtom, SearchQuery } from '../shared/search'

function atomSql(atom: SearchAtom, owner: string, params: string[]): string {
  switch (atom.kind) {
    case 'text':
      params.push(atom.value, atom.value)
      return '(instr(lower(n.title), lower(?)) > 0 OR instr(lower(n.body_plain), lower(?)) > 0)'
    case 'label':
      // `l.owner = ?` is what stops a label atom from matching another
      // owner's same-named label, since `note_labels` has no owner column.
      params.push(owner, atom.value)
      return 'EXISTS (SELECT 1 FROM note_labels nl JOIN labels l ON l.id = nl.label_id WHERE nl.note_id = n.id AND l.owner = ? AND l.name = ? COLLATE NOCASE)'
    case 'regex':
      throw new Error('regex atoms cannot be expressed in SQL yet')
  }
}

/**
 * Builds the `n`-aliased WHERE fragment for a parsed search query, or `null`
 * if the query has no groups (nothing to filter on). D1 rejects LIKE
 * patterns over 50 bytes and caps a statement at 100 bound params, so this
 * never emits LIKE and relies on `SEARCH_ATOMS_MAX` to stay well under the cap.
 */
export function buildSearchWhere(q: SearchQuery, owner: string): { sql: string; params: string[] } | null {
  if (q.groups.length === 0) return null

  const params: string[] = []
  const groupsSql = q.groups.map((group) => `(${group.map((atom) => atomSql(atom, owner, params)).join(' OR ')})`)
  return { sql: groupsSql.join(' AND '), params }
}
