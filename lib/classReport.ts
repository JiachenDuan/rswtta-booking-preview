export type CsvCell = string | number;

export function csvValue(value: CsvCell) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeCsvRows(rows: CsvCell[][]) {
  return rows.map((row) => row.map((cell) => csvValue(cell)).join(",")).join("\n");
}
