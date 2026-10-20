# Fabric Master — setup

Fabric Master is an iPhone-style web app. Your data lives in one Google Sheet in your Drive, photos and exports in two Drive folders next to it. A small Apps Script attached to the Sheet is the only thing the app talks to.

## What's in this folder

| Path | What it is |
| --- | --- |
| `dist/` | The finished app. These files get hosted. |
| `dist-demo/index.html` | The same app as one file, running on sample data stored on the phone. Good for a first look. |
| `backend/Code.gs`, `backend/appsscript.json` | The Google Sheet backend. |
| `src/` | Source code. `npm install`, then `npm run build` rebuilds `dist/`; `npm test` runs the checks. |

## 1. Create the Sheet and its backend

1. In Google Drive, create a new Google Sheet named **Fabric Master DB**.
2. In the Sheet, open **Extensions → Apps Script**.
3. Replace everything in `Code.gs` with the contents of `backend/Code.gs`.
4. Open **Project Settings**, tick **Show "appsscript.json" manifest file in editor**, then replace that file's contents with `backend/appsscript.json`.
5. Back in the editor, choose the `setup` function and press **Run**. Google asks you to authorise the script: it reads and writes this Sheet and creates two Drive folders, **Fabric Master Photos** and **Fabric Master Exports**. When it finishes, the Sheet shows the API key (also in the Sheet's menu **Fabric Master → Set up / show API key**).
6. Press **Deploy → New deployment**, pick **Web app**, set **Execute as: Me** and **Who has access: Anyone**, then **Deploy**. Copy the **Web app URL**.

"Anyone" means the URL can be reached without a Google sign-in, which is what lets the iPhone app work full-screen. Every request still needs an API key, so keep the URL and keys private. The key `setup` shows is the owner's key. To change it, delete `API_KEY` under **Project Settings → Script properties** and run `setup` again; other people's keys are not affected.

## 2. Host the app

The app is the static files in `dist/`. Any HTTPS static host works; two free options:

1. **GitHub Pages**: create a repository, upload the contents of `dist/`, then **Settings → Pages → Deploy from branch**. The address is `https://<your-user>.github.io/<repo>/`.
2. **Firebase Hosting** (your Google account): `npm i -g firebase-tools`, `firebase login`, `firebase init hosting` with `dist` as the public folder, then `firebase deploy`.

## 3. Install it on your iPhone

1. Open the app's address in **Safari**.
2. Tap **Share → Add to Home Screen**. From now on open it from the icon; it runs full-screen.
3. Tap the gear on the Fabrics screen, choose **Google Sheet**, paste the web app URL and the API key, tap **Test connection**, then **Save and reload data**.

The app opens with demo data until you connect the Sheet. Demo data never leaves the phone.

## 3b. Use it on a laptop

1. Open the same address in Chrome, Edge or Safari on the laptop. On a screen 1024 px or wider the app switches to the laptop layout: a sidebar instead of the tab bar, fabrics and yarns as tables (click a heading to sort), detail pages in two columns, and dialogs in the middle of the screen.
2. Open **Settings** in the sidebar, choose **Google Sheet**, paste the same web app URL and API key, then **Save and reload data**.
3. Optional: in Chrome or Edge, click the install icon at the right of the address bar to get the app in its own window.

Phone and laptop read and write the same Sheet. Each device reloads it when you come back to the app and every minute while it is open; the sidebar shows when it last synced and has a reload button. A reload that started before a save never undoes that save.

Keyboard on a laptop: **/** jumps to search, **Ctrl+S** (Cmd+S on a Mac) saves the form on screen, **Esc** closes a dialog.

## 4. Load your data

Add units, yarns and fabrics in the app, or paste rows straight into the Sheet's tabs below the header row and reload the app. Leave the `id` column empty for new rows; the Sheet fills it on the next load. Links between tabs use ids (for example `FabricYarns.fabric_id`), so paste parent rows first, reload once to get their ids, then paste the rows that point to them.

| Tab | Columns you fill | Notes |
| --- | --- | --- |
| Units | name, type, cost_per_pick, has_tfo, tfo_default_eff | type: Airjet or Waterjet. cost_per_pick in ₹ per metre per pick of PPI. has_tfo: TRUE or FALSE. |
| LoomGroups | unit_id, make, reed_width_cm, shedding, looms | For reference only. shedding: Plain, Cam or Dobby. |
| TfoTypes | unit_id, name | One row per set of TFO machines that runs at its own speed, e.g. M/C 1–12. |
| Yarns | name, kind, count, count_unit, material, form, … | kind: base or tpm. count_unit: D or Ne. A TPM yarn also needs base_yarn_id, tpm, twist (S, Z or S/Z); leave its count blank to use the base yarn's denier. tpm_delta is the ₹/kg added to the base yarn's rate (blank = ₹50). |
| YarnRates | yarn_id, rate, effective_date | Base yarns only. Rate ₹/kg; the latest date applies. A TPM yarn's rate is its base yarn's rate plus tpm_delta. |
| TfoSpeeds | unit_id, tfo_type_id, yarn_id, rpm, efficiency | One row per TPM yarn per TFO type. **rpm is entered already multiplied by 2.** efficiency blank = the unit's default. |
| Fabrics | name, weave, ppi, reed_space_in, greige_width_in, warp_shortage_pct, weft_shortage_pct, price, finish, … | Widths in inches, percentages as plain numbers (2 = 2%). finish: Greige or RFD; RFD adds rfd_shortage_pct, processing_charge, brokering_pct. vatav_pct is the VATAV % (blank = none). loom_rpm and loom_eff_pct are only for spindles. |
| FabricYarns | fabric_id, side, yarn_id, ends, parts, pattern | side: warp or weft. Warp rows carry ends; weft rows carry parts (pick share). |
| Assignments | fabric_id, unit_id | Puts a fabric in a unit's database. |
| Photos | (filled by the app) | Photos are added from the fabric screen. |

## 5. Give other people access

Each person gets their own key, so their edits carry their name and you can remove one person without touching anyone else.

1. On your own device open **Settings**. Under **People with access**, tap your own name once and set it (it starts as "Owner").
2. Tap **Give someone access**, type their name and tap **Make their key**.
3. Tap **Send setup on WhatsApp**. The message has the app link, the web app URL and their key, with the steps to set it up.
4. To remove someone, tap their name and **Remove access**. Their key stops working at once, and the copy of the data saved on their phone is cleared the next time it tries to sync.

What other people can and can't do:

- They read and change the same data you do, including deleting. They don't see anyone's keys and can't change who has access.
- They don't need access to the Sheet or the Drive folders; the script reads and writes on your behalf. The links to the Sheet and folders are hidden for them.
- Every fabric, yarn and unit shows **Last edited** with the person and time. **Settings → Recent changes** lists who added, changed or deleted what, newest first; the same list is in the Sheet's **Change log** tab. Edits typed straight into the Sheet are not in the log.
- If two people save the same fabric at the same moment, the later save wins. Different fabrics never affect each other.
- The Sheet's own **File → Version history** can bring back anything deleted by mistake.

Keys are kept in the script's properties (`API_KEY` for the owner, `PEOPLE` for everyone else), not in a tab of the Sheet.

## How the figures are worked out

1. Warp g/m = ends × denier ÷ 9,000 × (1 + warp shortage). Weft g/m = PPI × reed space (in) × denier ÷ 9,000 × (1 + weft shortage). Ne is converted with denier = 5,315 ÷ Ne.
2. RM cost ₹/m = each yarn's kg/m × its rate.
3. Greige: realisation per pick = (price − RM cost) ÷ PPI.
4. RFD: g = 1 ÷ (1 − RFD shortage). RFD cost = (RM cost + processing) × g + brokering × price. Realisation per pick = (price − RFD cost) ÷ (PPI × g).
5. With VATAV: the price less VATAV % is used in place of the full price; brokering stays on the full price. Both realisations are shown.
6. Profit per pick at a unit = realisation per pick with VATAV − the unit's cost per pick.
7. TFO output kg/spindle/day = RPM ÷ TPM × 1,440 × efficiency × denier ÷ 9,000,000. **Enter RPM already multiplied by 2; the app does not double it.** Spindles per loom = loom m/day × TPM yarn g/m ÷ 1,000 ÷ that output, for every TFO type of the unit.

## Updating later

1. App: rebuild with `npm run build` and upload the new `dist/`. Phones pick it up the next time the app opens online.
2. Backend: paste the new `Code.gs`, then **Deploy → Manage deployments → Edit → Version: New version → Deploy**. The URL stays the same.
