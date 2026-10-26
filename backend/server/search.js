import { SEARCH_RESULT_LIMIT } from './config.js';
import { servicesRuntime } from './runtime/services.js';
import { searchBoardState, sheetCellMatches } from './search-index.js';
import { cleanString } from './validation.js';

function searchCanvases(queryInput, limitInput, cursorInput, userId = null) {
  const query = cleanString(queryInput, 100, '').trim();
  if (!query) return { results: [], nextCursor: null };
  const limit = Math.min(SEARCH_RESULT_LIMIT, Math.max(1, Number.parseInt(limitInput, 10) || 20));
  const offset = Math.max(0, Number.parseInt(cursorInput, 10) || 0);
  const visibleOwnerIds = userId ? servicesRuntime.accountService.visibleOwnerIds(userId) : [];
  const ownerPlaceholders = visibleOwnerIds.map(() => '?').join(',');
  const accessClause = userId
    ? `AND c.owner_user_id IN (${ownerPlaceholders}) AND (c.owner_user_id = ? OR c.visibility = 'shared')`
    : '';
  let rows;
  if (Array.from(query).length >= 3) {
    const phrase = `"${query.replace(/"/g, '""')}"`;
    rows = servicesRuntime.database
      .prepare(
        `
      SELECT s.board_id, s.document_id, s.kind, s.label, substr(s.content, 1, 240) AS content, s.target_id, s.section_id, s.x, s.y,
             c.name AS canvas_name, c.sort_order, bm25(search_index) AS rank
      FROM search_index AS s
      JOIN canvas_catalog AS c ON c.board_id = s.board_id
      WHERE search_index MATCH ?
      ${accessClause}
      ORDER BY rank ASC, c.sort_order ASC, s.document_id ASC
      LIMIT ? OFFSET ?
    `
      )
      .all(phrase, ...visibleOwnerIds, ...(userId ? [userId] : []), limit + 1, offset);
  } else {
    const escaped = query.replace(/[\\%_]/g, (character) => `\\${character}`);
    rows = servicesRuntime.database
      .prepare(
        `
      SELECT d.board_id, d.document_id, d.kind, d.label, substr(d.content, 1, 240) AS content, d.target_id, d.section_id, d.x, d.y,
             c.name AS canvas_name, c.sort_order, 0 AS rank
      FROM search_documents AS d
      JOIN canvas_catalog AS c ON c.board_id = d.board_id
      WHERE (d.label LIKE ? ESCAPE '\\' OR d.content LIKE ? ESCAPE '\\')
      ${accessClause}
      ORDER BY c.sort_order ASC, d.document_id ASC
      LIMIT ? OFFSET ?
    `
      )
      .all(`%${escaped}%`, `%${escaped}%`, ...visibleOwnerIds, ...(userId ? [userId] : []), limit + 1, offset);
  }
  let hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  const sectionNames = new Map(
    servicesRuntime.database
      .prepare("SELECT board_id || ':' || target_id AS key, label FROM search_documents WHERE kind = 'section'")
      .all()
      .map((row) => [row.key, row.label])
  );
  const boardStates = new Map();
  const results = [];
  const resultFromRow = (row) => {
    return {
      canvasId: row.board_id,
      canvasName: row.canvas_name,
      documentId: row.document_id,
      kind: row.kind,
      label: row.label,
      excerpt: row.content.replace(/\s+/g, ' ').slice(0, 240),
      targetId: row.target_id,
      sectionId: row.section_id,
      sectionName: row.section_id ? sectionNames.get(`${row.board_id}:${row.section_id}`) || '' : '',

      x: Number(row.x),
      y: Number(row.y)
    };
  };
  for (const row of visible) {
    if (row.kind === 'sheet') {
      const boardState = searchBoardState(row.board_id, boardStates);
      const item = boardState?.items?.find((entry) => entry.id === row.target_id && entry.type === 'sheet');
      const matches = sheetCellMatches(item, query, limit - results.length + 1);
      if (matches.length) {
        for (const match of matches) {
          if (results.length >= limit) {
            hasMore = true;
            break;
          }
          results.push({
            ...resultFromRow(row),
            documentId: `item:${row.target_id}:sheet:${match.sheetId || match.sheetIndex}:cell:${match.row}:${match.column}`,
            label: `${match.sheetName}!${match.cellAddress}`,
            excerpt: match.cellText,
            ...match
          });
        }
        if (results.length >= limit) break;
        continue;
      }
    }
    results.push(resultFromRow(row));
    if (results.length >= limit) break;
  }
  return {
    results,
    nextCursor: hasMore ? String(offset + limit) : null
  };
}

export { searchCanvases };
