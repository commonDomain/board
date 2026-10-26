const zip = globalThis.FFlate || require('fflate');

const Formula = globalThis.SheetFormula || require('../../public/sheet-formula.js');

const MAX_COMPRESSED_BYTES = 10 * 1024 * 1024;

const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

const MAX_ARCHIVE_FILES = 256;

const MAX_IMPORTED_CELLS = 500000;

const MAX_SHARD_CELLS = 50000;

const MAX_OUTPUT_SHEETS = 32;

const CONTENT_TYPES_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
export {
  MAX_COMPRESSED_BYTES,
  MAX_INFLATED_BYTES,
  MAX_ARCHIVE_FILES,
  MAX_IMPORTED_CELLS,
  MAX_SHARD_CELLS,
  MAX_OUTPUT_SHEETS,
  CONTENT_TYPES_HEAD,
  ROOT_RELS,
  zip,
  Formula
};
