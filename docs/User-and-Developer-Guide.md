# SI Family Health Book — User & Developer Guide

A private family health-records app. Photos and PDFs of prescriptions, lab reports and other papers are stored in Google Drive, indexed in a Google Sheet, and opened through a phone app (PWA).

---

# Part 1 — User guide

## 1. Open the app
1. Tap the **Health Book** icon on your home screen.
2. Sign in with the Gmail address the Admin added for you. The first time, Google asks you to allow permissions; accept.
3. **First visit:** create a 6-digit PIN, then type it again to confirm. Each person has their own PIN.
4. **Next visits:** enter your PIN.

If you see **No access**, your Gmail is not on the family list. Ask an Admin to add it.

## 2. PIN and locking
- 5 wrong tries lock you out for 15 minutes.
- The app locks itself after 5 minutes in the background, and after 2 hours of use.
- Tap the 🔒 button (top bar) to lock it yourself.
- The PIN keeps casual users out. It does not encrypt the files.

## 3. Home screen
- **Search:** type a medicine, doctor or report name.
- **People:** tap a name to see that person's records. Admins also see **+ Add person**.
- **Recent:** the latest records.
- **Needs details (n):** records saved with only a photo. Open one and add a doctor, title or medicines.

## 4. Add a record
1. Tap **+** (or **Add record**).
2. **Who:** pick the person.
3. **File:** **Take photo** or **Choose photo or PDF**. Up to 5 pages per record, PDFs up to 10 MB. Photos are shrunk automatically.
4. **What:** pick a type (Rx, Lab, Dental, Eye, General, Other).
5. Optional: date, doctor or clinic, medicines (one per line, e.g. `Napa 500 - 1+1+1 - 5 days`), notes, title.
6. Tap **Save record**.

Tip: save the photo first and fill in the details later from **Needs details**.

## 5. View, share, edit, delete
- Open a record to see its pages. Use the arrows for multi-page records.
- **Share** sends the files through your phone's share menu. **Download** saves them.
- **Edit** (top right) changes the details or adds pages (up to 5). Saved pages cannot be removed.
- **Delete** is for Admins only. It hides the record; it is not erased (see Developer section 8).

## 6. Admin tasks
Open a person, then **Edit** (or **+ Add person**):
- **Gmail:** needed for anyone who signs in. Leave blank for children.
- **Role:** Admin can add people, edit people and delete records. Keep at least one active Admin.
- **Alert note:** allergies or long-term conditions. It shows in red on the person's page.
- **Active:** untick to hide a person without deleting their records.
- **Reset PIN:** tick it and save. The person creates a new PIN at their next sign-in.

If the only Admin forgets their PIN: open the Google Sheet, go to the **Members** tab, and clear that row's **PinSalt** and **PinHash** cells.

## 7. Problems
| You see | Do this |
|---|---|
| No access | Ask an Admin to add your Gmail address |
| Setup needed | The owner must run `setup()` once in Apps Script |
| Too many attempts | Wait 15 minutes, or ask an Admin to reset your PIN |
| Asks for Google sign-in again | Normal on iPhone, where the home-screen app keeps its own login |
| Old version showing | Close the app and reopen it. If it persists, clear the browser cache and reinstall |

---

# Part 2 — Developer guide

## 1. Architecture
```
Phone icon (PWA on Netlify)  ->  opens Apps Script web app (/exec)
                                     |-- Google Sheet: Members, Records
                                     |-- Drive: SI_FAMILY_MEDICAL_RECORDS/<Person>/ files
                                                         /_Backups/ weekly sheet copies
```
- The web app runs as **the user accessing it**. Each family member needs **Editor** access to the Sheet and the Drive folder, and approves permissions on first use.
- The PWA wrapper only provides the icon, manifest and service worker. It opens the `/exec` link in full screen when launched from the home screen.

## 2. Files
| File | Purpose |
|---|---|
| `Code.js` (Code.gs) | Server: auth, PIN, sheet and Drive access, endpoints, weekly backup |
| `Index.html` | Page markup and CSS |
| `JavaScript.html` | Client app logic, included by `Index.html` with `include('JavaScript')` |
| `appsscript.json` | Manifest: time zone, scopes, `executeAs: USER_ACCESSING`, `access: ANYONE` |
| `health-book-pwa/` | `index.html` (paste `/exec` link here), `manifest.json`, `sw.js`, `icons/` |

## 3. Data model
**Members:** `MemberID, Name, Relation, DOB, BloodGroup, Email, Role, AlertNote, Active, PinSalt, PinHash`

**Records:** `RecordID, MemberID, Category, Date, Title, Doctor, Medicines, Notes, Files, CreatedBy, CreatedAt, UpdatedBy, UpdatedAt, Deleted`

- `Files` is a JSON array: `[{ "id": driveFileId, "name": "...", "mime": "..." }]`.
- Dates are stored as text (`yyyy-MM-dd`). `DOB`, `PinSalt`, `PinHash`, `Date`, `CreatedAt` and `UpdatedAt` columns are formatted as plain text (`TEXT_COLS`).
- Values starting with `= + - @` get a leading apostrophe on write and lose it on read, so nobody can inject spreadsheet formulas (`safe_` / `unsafe_`).
- File names: `date_person_category_doctor_pN.ext`. Files live in a folder named after the person.

## 4. Security flow
1. `identity_()` reads `Session.getActiveUser().getEmail()` and finds the active member. No match throws `NO_ACCESS|email`.
2. `verifyPin` / `createPin` check the PIN and start a session. The token is stored in the **user cache** (`s_<token>`, 120 minutes, sliding).
3. Every protected endpoint takes `token` as its first argument and calls `requireUser(token)` or `requireAdmin_(token)`. A bad token throws `PIN_REQUIRED`, and the client shows the PIN screen.
4. PIN storage: salted SHA-256, 1000 rounds, stored in the Members sheet. Failed tries and lockout live in the user cache (5 tries, 15 minutes).
5. `getFile` only returns files that appear in a non-deleted record. Never build direct Drive links; they bypass the PIN.

Limits: the PIN is not encryption. Anyone with Sheet or Drive access can read the data directly.

## 5. Endpoints
| Function | Auth | What it does |
|---|---|---|
| `pinStatus()` | identity only | Has a PIN? Locked? Name and PIN length |
| `createPin(pin)` / `verifyPin(pin)` | identity only | Set or check PIN, returns a token |
| `logout(token)` | none | Ends the session |
| `bootstrap(token)` | user | Current user, members, records, today's date |
| `saveRecord(token, r, newFiles)` | user | Create or edit a record, store new files |
| `getFile(token, fileId)` | user | Returns a file as base64 |
| `saveMember(token, m)` | Admin | Create or edit a person, optional `ResetPin` |
| `deleteRecord(token, id)` | Admin | Soft delete (`Deleted = TRUE`) |
| `weeklyBackup()` | trigger | Copies the Sheet into `_Backups`, keeps the newest 8 |

Rule: any new server function the page calls takes `token` first, calls `requireUser(token)`, and must be added to `NEEDS_TOKEN` in `JavaScript.html`.

## 6. Settings you can change
In `Code.js`:
- `CFG`: `MAX_PAGES` (5), `MAX_PDF` (10 MB), `KEEP` (8 backups).
- `PIN`: `LEN`, `TRIES`, `LOCK_MIN`, `SESSION_MIN`. The client reads `LEN` from the server. Changing `LEN` does not affect PINs already set; reset them.
- `CATEGORIES`.

In `JavaScript.html`: the 5-minute background auto-lock (`visibilitychange` handler) and the photo size (`1600` px, quality `0.82` in `compress`).

**Add a category:** add it to `CATEGORIES` (Code.js), to `CATS` and `SHORT` (JavaScript.html), and add a `.c-<Name>` colour rule in `Index.html`.

## 7. Deploy and update
**First time:** run `setup()` once (creates the Sheet, folders, first Admin and the Sunday 3 am backup trigger), then **Deploy > New deployment > Web app** with *Execute as: User accessing the web app*. Share the Sheet and Drive folder with each family member.

**Identity test:** open the `/exec` link with `?test=1` from another Gmail account. It should say `Identity OK`.

**Code change:** edit, then **Deploy > Manage deployments > pencil > New version > Deploy**. The `/exec` link stays the same, so the PWA needs no change.

**PWA change:** edit the files, drag the folder onto the site's **Deploys** page in Netlify, and raise the `CACHE` name in `sw.js` (for example `v4`). Users may need to clear the cache once.

**Changing the Apps Script link:** edit `APP` in the PWA `index.html` and redeploy.

## 8. Maintenance
- **Restore a deleted record:** in the Records sheet, set `Deleted` to `FALSE`.
- **Restore from backup:** open a copy in `_Backups` and copy the rows back.
- **Remove a person:** untick **Active**. Their records and folder stay.
- **Rename a person:** the Drive folder is renamed automatically if no folder with the new name exists.

## 9. Troubleshooting (developer)
| Symptom | Cause and fix |
|---|---|
| `Identity EMPTY` on `?test=1` | Redeploy with *Execute as: User accessing the web app* |
| `NO_ACCESS|` with no email | Same as above, or the user is not signed in to Google |
| `SETUP_REQUIRED` | Run `setup()` once |
| PIN columns missing | Run `setup()` again; it rewrites the Members header |
| `PIN_REQUIRED` after a deploy | Normal; the session cache was reset. Enter the PIN again |
| Drive or Sheet permission errors | The user lacks Editor access to the Sheet or the folder |
| PWA will not install | Must be served over HTTPS with `manifest.json` and icons at the site root; open in Chrome or Safari, not an in-app browser; clear the cache |
