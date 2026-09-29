import { requiredLiteral } from '../shared/regex-literal'
import type { SearchAtom, SearchQuery } from '../shared/search'

export const TEXT_ATOM_SQL = '(instr(lower(n.title), lower(?)) > 0 OR instr(lower(n.body_plain), lower(?)) > 0)'
const CASE_SENSITIVE_LITERAL_SQL = '(instr(n.title, ?) > 0 OR instr(n.body_plain, ?) > 0)'

/**
 * Returns the SQL for an atom, or `null` for a regex with no required
 * literal (which cannot be narrowed in SQL).
 */
function atomSql(atom: SearchAtom, owner: string, params: string[]): string | null {
  switch (atom.kind) {
    case 'text':
      params.push(atom.value, atom.value)
      return TEXT_ATOM_SQL
    case 'label':
      // `l.owner = ?` is what stops a label atom from matching another
      // owner's same-named label, since `note_labels` has no owner column.
      params.push(owner, atom.value)
      return 'EXISTS (SELECT 1 FROM note_labels nl JOIN labels l ON l.id = nl.label_id WHERE nl.note_id = n.id AND l.owner = ? AND l.name = ? COLLATE NOCASE)'
    case 'regex': {
      const literal = requiredLiteral(atom.source, atom.flags)
      if (literal === null) return null
      params.push(literal, literal)
      // Only `i` folds case in the regex, so only then may SQL fold it too.
      // instr() is case-sensitive, unlike LIKE, which folds ASCII by default.
      return atom.flags.includes('i') ? TEXT_ATOM_SQL : CASE_SENSITIVE_LITERAL_SQL
    }
  }
}

/**
 * Builds the `n`-aliased WHERE fragment for a parsed search query, or `null`
 * if there is nothing to filter on. D1 rejects LIKE patterns over 50 bytes
 * and caps a statement at 100 bound params, so this never emits LIKE and
 * relies on `SEARCH_ATOMS_MAX` to stay well under the cap.
 *
 * A regex atom is narrowed by its required literal, so the SQL is a superset
 * of the real matches and the caller must still run the regex in JS. A group
 * holding a literal-less regex contributes no SQL at all, since an OR group
 * cannot be narrowed by only some of its atoms.
 */
export function buildSearchWhere(q: SearchQuery, owner: string): { sql: string; params: string[] } | null {
  const params: string[] = []
  const groupsSql: string[] = []

  for (const group of q.groups) {
    const groupParams: string[] = []
    const atomsSql: string[] = []
    for (const atom of group) {
      const sql = atomSql(atom, owner, groupParams)
      if (sql === null) break
      atomsSql.push(sql)
    }
    if (atomsSql.length < group.length) continue
    groupsSql.push(`(${atomsSql.join(' OR ')})`)
    params.push(...groupParams)
  }

  if (groupsSql.length === 0) return null
  return { sql: groupsSql.join(' AND '), params }
}
