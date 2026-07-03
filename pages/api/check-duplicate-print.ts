import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthStatus } from '../../lib/auth';
import { loadPrintLogRows } from '../../lib/logs';

function norm(v:any){ return String(v || '').trim(); }
function lower(v:any){ return norm(v).toLowerCase(); }

const ADMIN_TZ = 'Australia/Sydney';

function getTimeZoneOffsetMs(dateMs:number, timeZone:string){
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts:any = {};
  for (const p of dtf.formatToParts(new Date(dateMs))) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - dateMs;
}

function localSydneyMs(year:number, month:number, day:number, hour:number, minute:number, second:number){
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = getTimeZoneOffsetMs(guess, ADMIN_TZ);
  let ms = guess - offset;
  offset = getTimeZoneOffsetMs(ms, ADMIN_TZ);
  ms = guess - offset;
  return ms;
}

function parseSheetDate(v:any){
  const s = norm(v);
  if (!s) return 0;

  // Google Sheets published CSVs for these logs export dates like M/D/YYYY H:mm:ss.
  // Parse these as local Australia/Sydney wall time BEFORE Date.parse, otherwise JS
  // treats them as UTC/US browser time and the admin dashboard can show the next day.
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    // Prefer M/D/YYYY because your log sheet examples use 5/26/2026 and 6/1/2026.
    // If the first number is > 12, gracefully treat it as D/M/YYYY.
    const month = a > 12 ? b : a;
    const day = a > 12 ? a : b;
    let h = Number(m[4] || 0);
    const min = Number(m[5] || 0);
    const sec = Number(m[6] || 0);
    const ap = lower(m[7] || '');
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return localSydneyMs(y, month, day, h, min, sec);
    }
  }

  const direct = Date.parse(s);
  return Number.isFinite(direct) ? direct : 0;
}

function parseDate(v:any){ return parseSheetDate(v); }
function rowVal(row:any, ...keys:string[]){
  for (const k of keys) if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return String(row[k]).trim();
  return '';
}
function parseArr(v:any): string[] {
  if (Array.isArray(v)) return v.map(norm).filter(Boolean);
  const s = norm(v);
  if (!s) return [];
  try { const p = JSON.parse(s); return Array.isArray(p) ? p.map(norm).filter(Boolean) : [norm(p)].filter(Boolean); }
  catch { return [s]; }
}
async function loadRows(){
  const result = await loadPrintLogRows();
  return { rows: result.rows || [], configured: result.configured };
}

export default async function handler(req:NextApiRequest, res:NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const auth = await getAuthStatus(req);
  if (!auth.authed) return res.status(401).json({ ok:false, error:'Login required' });
  const body = req.body || {};
  const student = lower(body.student);
  if (!student) return res.status(200).json({ ok:true, duplicates: [], skipped:'missing student' });
  const folder = lower(body.folder);
  const kind = lower(body.kind);
  const ids = new Set(parseArr(body.material_ids || body.material_id).map(lower));
  const names = new Set(parseArr(body.names || body.name).map(lower));
  const windowMinutes = Number(body.windowMinutes || 20);
  const cutoff = Date.now() - Math.max(1, windowMinutes) * 60 * 1000;

  try {
    const { rows, configured } = await loadRows();
    if (!configured) return res.status(200).json({ ok:true, duplicates: [], skipped:'PRINT_LOG_CSV_URL not configured' });

    const duplicates = (rows || []).map((row:any) => {
      const raw = rowVal(row, 'Raw', 'raw');
      let parsed:any = {};
      try { parsed = raw ? JSON.parse(raw) : {}; } catch {}
      const ms = parseDate(rowVal(row, 'Timestamp', 'timestamp', 'when') || parsed.when);
      const rowStudent = rowVal(row, 'Student', 'student') || parsed.student || '';
      const rowTutor = rowVal(row, 'Tutor', 'tutor') || parsed.tutor || '';
      const rowFolder = parsed.folder || rowVal(row, 'Folder', 'folder') || '';
      const rowKind = rowVal(row, 'Kind', 'kind') || parsed.kind || '';
      const rowIds = parseArr(parsed.material_ids || parsed.material_id || rowVal(row, 'Types/MaterialID', 'material_id')).map(lower);
      const rowNames = parseArr(parsed.names || parsed.materials || rowVal(row, 'Names', 'names')).map(lower);
      return { ms, timestamp: rowVal(row, 'Timestamp', 'timestamp', 'when') || parsed.when || '', student: rowStudent, tutor: rowTutor, folder: rowFolder, kind: rowKind, ids: rowIds, names: rowNames };
    }).filter((r) => {
      if (!r.ms || r.ms < cutoff) return false;
      if (lower(r.student) !== student) return false;
      const sameFolder = folder && lower(r.folder) === folder;
      const idOverlap = r.ids.some(id => ids.has(id));
      const nameOverlap = r.names.some(n => names.has(n));
      if (kind === 'print-topic') return sameFolder || idOverlap || nameOverlap;
      return idOverlap || nameOverlap || sameFolder;
    }).sort((a,b) => b.ms - a.ms).slice(0,3).map((r) => ({
      timestamp: r.timestamp,
      tutor: r.tutor,
      student: r.student,
      folder: r.folder,
      kind: r.kind,
      names: r.names,
      minutesAgo: Math.max(0, Math.round((Date.now()-r.ms)/60000)),
    }));

    return res.status(200).json({ ok:true, duplicates });
  } catch(e:any) {
    return res.status(200).json({ ok:true, duplicates: [], warning:e?.message || 'duplicate check failed' });
  }
}
