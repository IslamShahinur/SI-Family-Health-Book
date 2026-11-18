/**
 * SI Family Health Book — Code.gs (Spec v2.0 + per-person PIN lock)
 * Run setup() once from the editor, then Deploy > New deployment > Web app.
 * Identity test (Step 0): open the web app URL with ?test=1 from another Gmail account.
 */

var CFG = {
  APP: 'SI Family Health Book',
  ROOT: 'SI_FAMILY_MEDICAL_RECORDS',
  BACKUPS: '_Backups',
  KEEP: 8,
  MAX_PAGES: 5,
  MAX_PDF: 10 * 1024 * 1024
};
var CATEGORIES = ['General', 'Dental', 'Eye', 'Prescription', 'Lab', 'Other'];
var PIN = { LEN: 6, TRIES: 5, LOCK_MIN: 15, SESSION_MIN: 120 };
var MEMBER_COLS = ['MemberID', 'Name', 'Relation', 'DOB', 'BloodGroup', 'Email', 'Role', 'AlertNote', 'Active', 'PinSalt', 'PinHash'];
var RECORD_COLS = ['RecordID', 'MemberID', 'Category', 'Date', 'Title', 'Doctor', 'Medicines', 'Notes',
  'Files', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt', 'Deleted'];
var TEXT_COLS = { Members: ['DOB', 'PinSalt', 'PinHash'], Records: ['Date', 'CreatedAt', 'UpdatedAt'] };
var MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
var CACHE_ = {};

/* ───────────── Web entry ───────────── */

function doGet(e) {
  if (e && e.parameter && e.parameter.test) {
    var a = Session.getActiveUser().getEmail();
    return ContentService.createTextOutput(
      a ? 'Identity OK. Visitor email: ' + a
        : 'Identity EMPTY. Redeploy with "Execute as: User accessing the web app" and share the Sheet + Drive folder with the family.');
  }
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(CFG.APP)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/* ───────────── One-time setup ───────────── */

function setup() {
  var p = props_();
  var root = rootFolder_();
  var ss;
  if (p.getProperty('SS_ID')) {
    ss = SpreadsheetApp.openById(p.getProperty('SS_ID'));
  } else {
    ss = SpreadsheetApp.create(CFG.APP);
    p.setProperty('SS_ID', ss.getId());
    DriveApp.getFileById(ss.getId()).moveTo(root);
  }
  ensureSheet_(ss, 'Members', MEMBER_COLS);
  ensureSheet_(ss, 'Records', RECORD_COLS);
  backupFolder_();

  var owner = Session.getEffectiveUser().getEmail().toLowerCase();
  CACHE_ = {};
  var exists = readMembers_().some(function (m) { return m.Email.toLowerCase() === owner; });
  if (!exists) {
    appendRow_('Members', MEMBER_COLS, {
      MemberID: newId_('M'), Name: 'Me', Relation: 'Self', DOB: '', BloodGroup: '',
      Email: owner, Role: 'Admin', AlertNote: '', Active: true
    });
  }
  installBackupTrigger();
  Logger.log('Setup complete. Spreadsheet: ' + ss.getUrl());
}

function installBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'weeklyBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
}

/* ───────────── Auth gate ───────────── */

// Step 1: which Google account is this? (no PIN needed)
function identity_() {
  if (!props_().getProperty('SS_ID')) throw new Error('SETUP_REQUIRED');
  var email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('NO_ACCESS|');
  var me = readMembers_().filter(function (m) {
    return m.Active && m.Email && m.Email.toLowerCase() === email;
  })[0];
  if (!me) throw new Error('NO_ACCESS|' + email);
  return me;
}

// Step 2: has this person unlocked with their PIN?
function requireUser(token) {
  var me = identity_();
  var uc = CacheService.getUserCache();
  if (!token || !uc.get('s_' + token)) throw new Error('PIN_REQUIRED');
  uc.put('s_' + token, '1', PIN.SESSION_MIN * 60); // sliding session
  return me;
}

function requireAdmin_(token) {
  var me = requireUser(token);
  if (me.Role !== 'Admin') throw new Error('Only an Admin can do this.');
  return me;
}

/* ───────────── PIN ───────────── */

function hashPin_(pin, salt) {
  var salted = Utilities.newBlob(pin + ':' + salt).getBytes();
  var d = salted;
  for (var i = 0; i < 1000; i++) d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, d.concat(salted));
  return d.map(function (b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join('');
}

function memberRow_(memberId) {
  return readTable_('Members').filter(function (o) { return o.MemberID === memberId; })[0];
}

function startSession_() {
  var token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getUserCache().put('s_' + token, '1', PIN.SESSION_MIN * 60);
  return { ok: true, token: token };
}

function pinStatus() {
  var me = identity_();
  var row = memberRow_(me.MemberID);
  return {
    hasPin: !!(row && row.PinHash),
    locked: !!CacheService.getUserCache().get('pin_lock'),
    len: PIN.LEN,
    name: me.Name
  };
}

function createPin(pin) {
  var me = identity_();
  pin = String(pin || '');
  if (!/^\d+$/.test(pin) || pin.length !== PIN.LEN) throw new Error('PIN must be ' + PIN.LEN + ' digits.');
  return withLock_(function () {
    var row = memberRow_(me.MemberID);
    if (!row) throw new Error('Person not found.');
    if (row.PinHash) throw new Error('A PIN is already set. Ask an Admin to reset it.');
    var salt = Utilities.getUuid();
    sheet_('Members').getRange(row._row, MEMBER_COLS.indexOf('PinSalt') + 1, 1, 2)
      .setValues([[salt, hashPin_(pin, salt)]]);
    return startSession_();
  });
}

function verifyPin(pin) {
  var me = identity_(), uc = CacheService.getUserCache();
  if (uc.get('pin_lock')) return { ok: false, locked: true };
  var row = memberRow_(me.MemberID);
  if (!row || !row.PinHash) return { ok: false, error: 'No PIN set yet.' };
  if (hashPin_(String(pin || ''), String(row.PinSalt)) === String(row.PinHash)) {
    uc.remove('pin_fails');
    return startSession_();
  }
  var fails = Number(uc.get('pin_fails') || 0) + 1;
  if (fails >= PIN.TRIES) {
    uc.put('pin_lock', '1', PIN.LOCK_MIN * 60);
    uc.remove('pin_fails');
    return { ok: false, locked: true };
  }
  uc.put('pin_fails', String(fails), PIN.LOCK_MIN * 60);
  return { ok: false, left: PIN.TRIES - fails };
}

function logout(token) {
  if (token) CacheService.getUserCache().remove('s_' + token);
  return true;
}

/* ───────────── Endpoints ───────────── */

function bootstrap(token) {
  var me = requireUser(token);
  var records = readTable_('Records').filter(function (o) { return !isTrue_(o.Deleted); }).map(toRecord_);
  return { user: me, members: readMembers_(), records: records, today: today_() };
}

function saveMember(token, m) {
  var me = requireAdmin_(token);
  return withLock_(function () {
    CACHE_ = {};
    var all = readTable_('Members');
    var existing = null;
    if (m.MemberID) {
      existing = all.filter(function (o) { return o.MemberID === m.MemberID; })[0];
      if (!existing) throw new Error('Person not found.');
    }
    var name = clean_(m.Name, 60);
    if (!name) throw new Error('Name is required.');
    var email = clean_(m.Email, 120).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
    var role = m.Role === 'Admin' ? 'Admin' : 'Member';
    if (role === 'Admin' && !email) throw new Error('An Admin needs a Gmail address.');
    var active = m.Active !== false;
    var id = existing ? existing.MemberID : newId_('M');
    all.forEach(function (o) {
      if (email && o.MemberID !== id && isTrue_(o.Active) && String(o.Email).toLowerCase() === email)
        throw new Error('That email already belongs to another person.');
    });
    var others = all.filter(function (o) { return o.MemberID !== id; });
    var admins = others.filter(function (o) { return isTrue_(o.Active) && o.Role === 'Admin' && o.Email; }).length;
    if (!(active && role === 'Admin' && email) && admins < 1) throw new Error('At least one active Admin is required.');

    var row = {
      MemberID: id, Name: name, Relation: clean_(m.Relation, 40), DOB: /^\d{4}-\d{2}-\d{2}$/.test(m.DOB) ? m.DOB : '',
      BloodGroup: clean_(m.BloodGroup, 5), Email: email, Role: role,
      AlertNote: clean_(m.AlertNote, 600), Active: active
    };
    row.PinSalt = existing ? existing.PinSalt : '';
    row.PinHash = existing ? existing.PinHash : '';
    if (existing && m.ResetPin) { row.PinSalt = ''; row.PinHash = ''; }
    if (existing) {
      if (existing.Name !== name) renameFolder_(existing.Name, name);
      writeRow_('Members', MEMBER_COLS, existing._row, row);
    } else {
      appendRow_('Members', MEMBER_COLS, row);
    }
    CACHE_ = {};
    var members = readMembers_();
    var self = members.filter(function (x) { return x.MemberID === me.MemberID; })[0] || me;
    return { members: members, user: self };
  });
}

function saveRecord(token, r, newFiles) {
  var me = requireUser(token);
  newFiles = newFiles || [];
  return withLock_(function () {
    var all = readTable_('Records');
    var existing = null;
    if (r.RecordID) {
      existing = all.filter(function (o) { return o.RecordID === r.RecordID; })[0];
      if (!existing || isTrue_(existing.Deleted)) throw new Error('Record not found.');
    }
    var memberId = existing ? existing.MemberID : String(r.MemberID || '');
    var mem = readMembers_().filter(function (x) { return x.MemberID === memberId; })[0];
    if (!mem || !mem.Active) throw new Error('Choose a valid person.');

    var cat = CATEGORIES.indexOf(r.Category) > -1 ? r.Category : 'Other';
    var date = /^\d{4}-\d{2}-\d{2}$/.test(r.Date) ? r.Date : today_();
    var files = existing ? parseFiles_(existing.Files) : [];
    if (files.length + newFiles.length > CFG.MAX_PAGES) throw new Error('A record holds up to ' + CFG.MAX_PAGES + ' pages.');
    if (!files.length && !newFiles.length) throw new Error('Add a photo or a file first.');

    var doctor = clean_(r.Doctor, 120);
    var folder = personFolder_(mem.Name);
    var docSlug = slug_(doctor), perSlug = slug_(mem.Name);
    newFiles.forEach(function (f) {
      var ext = MIME_EXT[f.mime];
      if (!ext) throw new Error('Only photos and PDF files are supported.');
      var bytes = Utilities.base64Decode(f.data);
      if (f.mime === 'application/pdf' && bytes.length > CFG.MAX_PDF) throw new Error('PDF files can be up to 10 MB.');
      var name = [date, perSlug, cat, docSlug, 'p' + (files.length + 1)].filter(Boolean).join('_') + '.' + ext;
      var file = folder.createFile(Utilities.newBlob(bytes, f.mime, name));
      files.push({ id: file.getId(), name: name, mime: f.mime });
    });

    var stamp = now_();
    var row = {
      RecordID: existing ? existing.RecordID : newId_('R'),
      MemberID: memberId, Category: cat, Date: date,
      Title: clean_(r.Title, 120), Doctor: doctor,
      Medicines: clean_(r.Medicines, 2000), Notes: clean_(r.Notes, 4000),
      Files: JSON.stringify(files),
      CreatedBy: existing ? existing.CreatedBy : me.Email, CreatedAt: existing ? existing.CreatedAt : stamp,
      UpdatedBy: me.Email, UpdatedAt: stamp, Deleted: false
    };
    if (existing) writeRow_('Records', RECORD_COLS, existing._row, row);
    else appendRow_('Records', RECORD_COLS, row);
    return { record: toRecord_(row) };
  });
}

function getFile(token, fileId) {
  requireUser(token);
  var allowed = readTable_('Records').some(function (o) {
    return !isTrue_(o.Deleted) && String(o.Files).indexOf(String(fileId)) > -1;
  });
  if (!allowed) throw new Error('File not found.');
  var f = DriveApp.getFileById(fileId);
  return { name: f.getName(), mime: f.getMimeType(), data: Utilities.base64Encode(f.getBlob().getBytes()) };
}

function deleteRecord(token, id) {
  var me = requireAdmin_(token);
  return withLock_(function () {
    var o = readTable_('Records').filter(function (x) { return x.RecordID === id; })[0];
    if (!o) throw new Error('Record not found.');
    o.Deleted = true; o.UpdatedBy = me.Email; o.UpdatedAt = now_();
    writeRow_('Records', RECORD_COLS, o._row, o);
    return { ok: true };
  });
}

function weeklyBackup() {
  var ssId = props_().getProperty('SS_ID');
  if (!ssId) return;
  var folder = backupFolder_();
  DriveApp.getFileById(ssId).makeCopy('Backup ' + Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'), folder);
  var list = [], it = folder.getFiles();
  while (it.hasNext()) list.push(it.next());
  list.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  list.slice(CFG.KEEP).forEach(function (f) { f.setTrashed(true); });
}

/* ───────────── Sheets helpers ───────────── */

function props_() { return PropertiesService.getScriptProperties(); }
function tz_() { return Session.getScriptTimeZone() || 'Asia/Dhaka'; }
function now_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function newId_(p) { return p + Date.now().toString(36) + Utilities.getUuid().slice(0, 4); }
function isTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function sheet_(name) {
  return SpreadsheetApp.openById(props_().getProperty('SS_ID')).getSheetByName(name);
}

function ensureSheet_(ss, name, cols) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    var first = ss.getSheets()[0];
    if (first.getLastRow() === 0 && first.getName() !== 'Members' && first.getName() !== 'Records') {
      sh = first.setName(name);
    } else {
      sh = ss.insertSheet(name);
    }
  }
  sh.getRange(1, 1, 1, cols.length).setValues([cols])
    .setFontWeight('bold').setBackground('#17434A').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  (TEXT_COLS[name] || []).forEach(function (c) {
    sh.getRange(1, cols.indexOf(c) + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  });
  return sh;
}

// Neutralise spreadsheet formulas: a leading = + - @ gets a leading apostrophe.
function clean_(v, max) {
  var s = String(v == null ? '' : v).replace(/\r\n/g, '\n').trim();
  if (max) s = s.slice(0, max);
  return s;
}
function safe_(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}
function unsafe_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  if (typeof v === 'string' && /^'[=+\-@]/.test(v)) return v.slice(1);
  return v;
}

function readTable_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
  var head = vals[0], out = [];
  for (var i = 1; i < vals.length; i++) {
    if (!vals[i][0]) continue;
    var o = { _row: i + 1 };
    for (var j = 0; j < head.length; j++) o[head[j]] = unsafe_(vals[i][j]);
    out.push(o);
  }
  return out;
}

function toRow_(cols, o) {
  return cols.map(function (c) { return safe_(o[c] === undefined || o[c] === null ? '' : o[c]); });
}
function writeRow_(name, cols, row, o) {
  sheet_(name).getRange(row, 1, 1, cols.length).setValues([toRow_(cols, o)]);
}
function appendRow_(name, cols, o) {
  var sh = sheet_(name);
  sh.getRange(sh.getLastRow() + 1, 1, 1, cols.length).setValues([toRow_(cols, o)]);
}

function readMembers_() {
  if (CACHE_.members) return CACHE_.members;
  CACHE_.members = readTable_('Members').map(function (o) {
    return {
      MemberID: o.MemberID, Name: String(o.Name), Relation: String(o.Relation || ''), DOB: String(o.DOB || ''),
      BloodGroup: String(o.BloodGroup || ''), Email: String(o.Email || ''),
      Role: o.Role === 'Admin' ? 'Admin' : 'Member', AlertNote: String(o.AlertNote || ''), Active: isTrue_(o.Active)
    };
  });
  return CACHE_.members;
}

function parseFiles_(s) {
  try { var a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

function toRecord_(o) {
  return {
    RecordID: o.RecordID, MemberID: o.MemberID, Category: String(o.Category), Date: String(o.Date),
    Title: String(o.Title || ''), Doctor: String(o.Doctor || ''), Medicines: String(o.Medicines || ''),
    Notes: String(o.Notes || ''), Files: parseFiles_(o.Files), CreatedAt: String(o.CreatedAt || '')
  };
}

/* ───────────── Drive helpers ───────────── */

function rootFolder_() {
  var p = props_(), id = p.getProperty('ROOT_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate */ } }
  var f = DriveApp.createFolder(CFG.ROOT);
  p.setProperty('ROOT_ID', f.getId());
  return f;
}

function backupFolder_() {
  var root = rootFolder_(), it = root.getFoldersByName(CFG.BACKUPS);
  return it.hasNext() ? it.next() : root.createFolder(CFG.BACKUPS);
}

function folderName_(name) {
  return String(name).replace(/[\\\/:*?"<>|]/g, '-').trim() || 'Person';
}

function personFolder_(name) {
  var root = rootFolder_(), n = folderName_(name), it = root.getFoldersByName(n);
  return it.hasNext() ? it.next() : root.createFolder(n);
}

function renameFolder_(oldName, newName) {
  var root = rootFolder_(), o = root.getFoldersByName(folderName_(oldName));
  if (o.hasNext() && !root.getFoldersByName(folderName_(newName)).hasNext()) o.next().setName(folderName_(newName));
}

function slug_(s) {
  return String(s || '').replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 24);
}
