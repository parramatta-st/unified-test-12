import { appendSheetRows, loadRowsPrivateFirst, privateSheetsConfigured, sheetNames, spreadsheetIdFor } from './googleSheets';

export const FEEDBACK_LOG_HEADERS = [
  'timestamp', 'campusKey', 'campusName', 'tutorName', 'studentId', 'studentName', 'studentFirstName', 'studentLastName', 'studentYear',
  'parentName', 'parentEmail', 'mode', 'feedbackType', 'programKey', 'programLabel', 'templateIndex', 'lessonNumber', 'assessmentName',
  'completionStatus', 'sourceForm', 'year', 'subject', 'strand', 'lesson', 'topic', 'subjectLine', 'messageId'
];

export const PRINT_LOG_HEADERS = [
  'Timestamp', 'Kind', 'Student', 'Tutor', 'Year', 'Subject', 'Topic', 'Types/MaterialID', 'Names', 'Qty', 'Printer', 'OK', 'PrintColorMode', 'Raw'
];

function norm(v: any) { return String(v ?? '').trim(); }

export async function loadFeedbackLogRows() {
  return loadRowsPrivateFirst({
    kind: 'FEEDBACK_LOG',
    sheetName: sheetNames.feedbackLog(),
    csvUrls: [
      process.env.FEEDBACK_PROGRESS_CSV_URL || '',
      process.env.NEXT_PUBLIC_FEEDBACK_PROGRESS_CSV_URL || '',
      process.env.FEEDBACK_LOG_CSV_URL || '',
      process.env.SENTMSGS_CSV_URL || '',
      process.env.NEXT_PUBLIC_SENTMSGS_CSV_URL || '',
    ],
  });
}

export async function loadPrintLogRows() {
  return loadRowsPrivateFirst({
    kind: 'PRINT_LOG',
    sheetName: sheetNames.printLog(),
    csvUrls: [
      process.env.PRINT_LOG_CSV_URL || '',
      process.env.PRINT_PROGRESS_CSV_URL || '',
      process.env.NEXT_PUBLIC_PRINT_LOG_CSV_URL || '',
      process.env.PRINT_LOG_READ_CSV_URL || '',
    ],
  });
}

export async function appendFeedbackLog(payload: any) {
  if (!privateSheetsConfigured()) return { saved: false, reason: 'private sheets not configured' };
  const row: Record<string, any> = { ...payload };
  row.timestamp = row.timestamp || row.when || new Date().toISOString();
  await appendSheetRows(sheetNames.feedbackLog(), FEEDBACK_LOG_HEADERS, [row], spreadsheetIdFor('FEEDBACK_LOG'));
  return { saved: true };
}

export function buildPrintLogRow(body: any) {
  const raw = body || {};
  const names = Array.isArray(raw.names) ? raw.names : raw.names ? [raw.names] : [];
  const ids = Array.isArray(raw.material_ids) ? raw.material_ids : raw.material_id ? [raw.material_id] : [];
  const modes = raw.printColorModes || raw.colorModeLabels || raw.printColorMode || raw.print_color_mode || raw.colorMode || raw.color_mode || '';
  return {
    Timestamp: raw.when || raw.timestamp || new Date().toISOString(),
    Kind: raw.kind || '',
    Student: raw.student || '',
    Tutor: raw.tutor || '',
    Year: raw.year || '',
    Subject: raw.subject || '',
    Topic: raw.topic || raw.strand || '',
    'Types/MaterialID': ids.length ? JSON.stringify(ids) : (raw.type || raw.name || ''),
    Qty: raw.qty || '',
    Printer: raw.printer || '',
    OK: raw.ok === undefined ? '' : String(!!raw.ok).toUpperCase(),
    PrintColorMode: Array.isArray(modes) ? JSON.stringify(modes) : norm(modes),
    Raw: JSON.stringify(raw),
    Names: names.length ? JSON.stringify(names) : '',
  };
}

export async function appendPrintLog(payload: any) {
  if (!privateSheetsConfigured()) return { saved: false, reason: 'private sheets not configured' };
  await appendSheetRows(sheetNames.printLog(), PRINT_LOG_HEADERS, [buildPrintLogRow(payload)], spreadsheetIdFor('PRINT_LOG'));
  return { saved: true };
}
