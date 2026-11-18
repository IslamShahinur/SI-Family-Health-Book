# SI Family Health Book

Master Specification v2.0 · Simplified redesign of SI Family Medical Records

## 1. Purpose

A private family health book on Google Apps Script, Google Sheets and Google Drive. Every person has a timeline of documents (prescriptions, lab reports, dental, eye, other). The **original PDF or photo is always kept**, and the record is just a few typed fields beside it. Nothing is auto-extracted, so nothing can be silently wrong.

## 2. Design Principles

1. **The original file is the truth.** Typed fields only help you find it.
2. **Snap first, details later.** A record needs only a person and a file.
3. **Three taps to save:** Who → Snap → Save.
4. **Load once, search instantly.** The app loads all records once; search and filters run on the phone with no waiting.
5. **Drive stays readable without the app.** Files are auto-named and foldered per person.
6. **No OCR, no review workflow.** Less to build, less to get wrong.

## 3. What Changed from v1.0

| v1.0 | v2.0 |
| --- | --- |
| 10 project files | **4 files** |
| 5 sheets | **2 sheets** (Members, Records) |
| 7 phases | **1 test + 2 phases** |
| 5 navigation items, 6 wireframes | **3 screens** + one record view |
| OCR + Review Needed / Verified | Removed. A computed **Needs Details** tray replaces them |
| Separate Medicines sheet | One text field with autocomplete |
| Controlled document links | Removed (a link to a private Drive file does not open for outsiders). Share the file itself |

## 4. Project Files (4)

| Path | Role |
| --- | --- |
| `FAMILY-MEDICAL-RECORDS/Code.gs` | All server code: `doGet`, `setup`, `requireUser` gate, endpoints, Sheets and Drive helpers, backup |
| `FAMILY-MEDICAL-RECORDS/Index.html` | Page markup and CSS (CSS is small, so it lives here) |
| `FAMILY-MEDICAL-RECORDS/JavaScript.html` | All client logic, included into Index.html |
| `FAMILY-MEDICAL-RECORDS/appsscript.json` | Config: web app runs as the owner, access is Anyone with Google account, scopes spreadsheets + drive + userinfo.email, timezone Asia/Dhaka |

## 5. Architecture

```text
Phone / PC  --google.script.run-->  Code.gs  -->  Google Sheet (2 tabs)
   (load once,                          |
    filter locally)                     +-->  Drive: one folder per person
```

One-time `setup()` creates the spreadsheet, tabs, root folder and adds the owner as Admin. IDs are kept in Script Properties, so there is no manual configuration.

## 6. Data

### Sheet: Members

| Column | Notes |
| --- | --- |
| MemberID | Unique ID |
| Name, Relation, DOB, BloodGroup | Profile (age is computed) |
| Email | Blank for children and dependants |
| Role | Admin or Member |
| AlertNote | Allergies, long-term conditions: shown as the Alert Card |
| Active | TRUE / FALSE |

### Sheet: Records

| Column | Notes |
| --- | --- |
| RecordID, MemberID | Unique ID and owner |
| Category | General, Dental, Eye, Prescription, Lab, Other |
| Date | Defaults to today |
| Title | Optional; auto-built as Category + Doctor if blank |
| Doctor | Doctor and/or clinic, one field |
| Medicines | One per line, plain text |
| Notes | Diagnosis, advice, anything else |
| Files | JSON list of Drive file IDs and names (1 to 5 pages) |
| CreatedBy, CreatedAt, UpdatedBy, UpdatedAt | Audit trail, no separate log sheet |
| Deleted | TRUE = soft deleted |

### Drive layout

```text
SI_FAMILY_MEDICAL_RECORDS/
  Father/
    2026-10-12_Father_Prescription_DrRahman_p1.jpg
    2026-10-12_Father_Prescription_DrRahman_p2.jpg
  Mother/
    2026-10-08_Mother_Eye_DrSen.pdf
```

The app names and files every upload automatically. If the app ever disappears, the archive is still organised.

## 7. Screens

### 7.1 Home

```text
+----------------------------------------+
| SI Family Health Book            [ + ] |
+----------------------------------------+
| [ Search medicine, doctor, report... ] |
|                                        |
|  ( Me )  (Wife)  (Father)  (Mother)    |
|   34y     31y      66y       60y       |
|                                        |
| NEEDS DETAILS (2)                   >  |
| ------------------------------------   |
| RECENT                                 |
| 12 Oct  Father  Rx      Dr. Rahman     |
| 08 Oct  Mother  Eye     Dr. Sen        |
| 02 Oct  Wife    Lab     Blood test     |
| 28 Sep  Me      Dental  Dr. Das        |
+----------------------------------------+
```

The search box searches everyone at once. Tapping a person opens their timeline.

### 7.2 Add Record (the 3-tap screen)

```text
+----------------------------------------+
| < Cancel                   New record  |
+----------------------------------------+
| WHO                                    |
| ( Me ) (Wife) [Father] (Mother)        |
|                                        |
| FILE                                   |
| [ Take photo ]    [ Choose file ]      |
| [pg1] [pg2] [ + page ]                 |
|                                        |
| WHAT                                   |
| [Rx] [Lab] [Dental] [Eye] [Gen] [Oth]  |
|                                        |
| -- optional: fill now or later ------- |
| Date    [ 12 Oct 2026 ]                |
| Doctor  [ Dr. Rahman          ] suggest|
| Medicines (one per line)               |
| [ Napa 500 - 1+1+1 - 5 days       ]    |
| Notes   [ Diagnosis, advice...    ]    |
|                                        |
| [               SAVE               ]   |
+----------------------------------------+
```

Only **Who** and **File** are required. Category defaults to the last one used.

### 7.3 Member Timeline

```text
+----------------------------------------+
| < Back                         [ Edit ]|
+----------------------------------------+
| FATHER                66y   Blood B+   |
| +------------------------------------+ |
| | ALERT: (allergies / conditions)    | |
| +------------------------------------+ |
| [All] [Rx] [Lab] [Dental] [Eye] [..]   |
| [ Search in Father...              ]   |
|                                        |
| OCTOBER 2026                           |
| 12  Rx   Dr. Rahman              [2pg] |
|     Napa 500, Losectil 20              |
| 03  Lab  Blood test              [1pg] |
|                                        |
| SEPTEMBER 2026                         |
| 21  Gen  Dr. Karim               [1pg] |
+----------------------------------------+
```

The **Alert Card** keeps allergies and long-term conditions at the top of every person’s page, ready to show a doctor.

### 7.4 Record View

```text
+----------------------------------------+
| < Back                         [ Edit ]|
+----------------------------------------+
| Prescription - Father                  |
| 12 Oct 2026 - Dr. Rahman               |
| +------------------------------------+ |
| |                                    | |
| |          [ FILE PREVIEW ]          | |
| |          page 1 of 2   < >         | |
| +------------------------------------+ |
| MEDICINES                              |
| Napa 500 - 1+1+1 - 5 days              |
| Losectil 20 - 0+0+1 - 14 days          |
| NOTES                                  |
| Review after 2 weeks                   |
|                                        |
| [ Share ]  [ Download ]  [ Delete ]    |
+----------------------------------------+
```

Delete is visible to Admin only. Members are managed from the Edit button on a person’s page (Admin only).

## 8. Smart Behaviours

- **Needs Details tray.** A record with no title, doctor or medicines is flagged. This is computed, with no status column and no review workflow. Open it, type a few words, and it leaves the tray.
- **Autocomplete.** Doctor names and medicine lines are suggested from earlier records, which keeps spelling consistent and makes search reliable.
- **Instant search.** Matches title, doctor, medicines, notes, person and category, locally on the phone.
- **Multi-page records.** One prescription with several photos stays one record (up to 5 files).
- **Image compression.** Photos are resized in the browser to about 1600 px JPEG before upload. PDFs are limited to 10 MB.
- **Preview through the script.** Raw Drive preview links will not open for family members, because the files are private to the owner. The server reads the file and sends it to the app, which shows it as a local blob.
- **Sharing.** The Share button tries the phone’s native share sheet with the actual file (WhatsApp appears there). If the browser blocks it, it falls back to Download, and Drive’s own Share menu is the backup.

## 9. Server Endpoints (Code.gs)

Every endpoint starts with `requireUser()`.

| Function | Purpose |
| --- | --- |
| `bootstrap()` | Returns the signed-in user, all members and all non-deleted records |
| `saveMember(m)` | Add or edit a member (Admin only) |
| `saveRecord(r, newFiles)` | Add or edit a record, store files, auto-name them |
| `getFile(fileId)` | Returns a file as base64 for preview, download or share |
| `deleteRecord(id)` | Soft delete (Admin only) |
| `setup()` | One-time creation of sheet, folders and owner |
| `weeklyBackup()` | Time trigger: copies the spreadsheet to a Backups folder, keeps the last 8 |

## 10. Security

- A single `requireUser()` gate checks the signed-in email against active members on every call.
- The Sheet and the Drive folder stay private to the owner. No public or link-sharing is ever used.
- Values written to Sheets are sanitised (a leading `=`, `+`, `-` or `@` is neutralised).
- Writes use `LockService` so two people saving together cannot corrupt rows.
- Delete is soft and Admin only. A record can be restored by clearing the Deleted flag in the Sheet.
- Drive keeps its own trash and version history. The weekly backup protects the Sheet.
- Final test with an unauthorised Google account must show no data.

## 11. Build Plan

### Step 0: Identity test (about 30 minutes, do first)

Deploy a tiny web app that only prints the visitor’s email. Open it from your wife’s Gmail. If the email shows, the design stands. If it comes back empty, switch the deployment to Execute as User accessing, and share the Sheet and folder with the family. The rest of the design is unchanged.

### Phase 1: A usable app

Setup, auth gate, members, Add Record with Drive storage, timeline, record view, search, download. **Done when you and your wife can store and find a real prescription.**

### Phase 2: Share and harden

Native share, image compression polish, soft delete, weekly backup, Alert Card, unauthorised-access test.

## 12. Acceptance Criteria

1. Authorised family members sign in with their own Gmail; others see nothing.
2. Children have profiles without Gmail accounts.
3. Each person’s records are separate and chronological.
4. PDF and image upload works on mobile and desktop, including multi-page records.
5. Original files are never altered or replaced.
6. A record can be saved with only a person and a file.
7. Search finds medicines, doctors, titles and notes instantly.
8. A file can be shared to WhatsApp or downloaded.
9. Only Admin can delete or manage members.
10. Weekly backup runs.

## 13. Later (not in v1)

- A **Fill with AI** button for printed documents, with every field checked by you before saving.
- A one-page **Visit Summary** per person (alerts, current medicines, recent records) to show a doctor.
