// The Guide: a short how-to for every screen, in plain English.
// Writing rules: sentences under 15 words, one action per step, button names in **bold** exactly as on screen.
// [[term]] links a word to the word list (WORDS below). Keep money out of examples.
// Each topic: id, title, screen (route it explains, for the ? buttons), purpose (one line), shot (screenshot file in
// public/guide, taken by scripts/guide-shots.py), steps, tips ("Good to know"), how (optional maths), related.
// Update the matching topic and WHATS_NEW in every release.

export const TOPICS = [
  {
    id: 'start',
    title: 'Start here',
    purpose: 'What this app does, and how to get going in a few minutes.',
    shot: 'start.webp',
    intro: [
      'This app keeps every fabric and yarn of Hanuman Group in one place.',
      'For each fabric it shows the yarn it uses, what it costs, and what it earns per [[pick]].',
      'The Planner shows what a day of weaving uses and earns in each unit.',
    ],
    steps: [
      'Open the link you were sent in Safari on iPhone, or Chrome on a laptop.',
      'On iPhone, tap **Share**, then **Add to Home Screen**. Open the app from the new icon.',
      'Tap the gear at the top left to open **Settings**.',
      'Paste the **Web app URL** and your **API key** from your setup message.',
      'Tap **Save and reload data**. Your fabrics appear.',
    ],
    tips: [
      'Your key is only for you. Do not forward it.',
      'Every change you save reaches everyone else within a minute.',
      'The app keeps a copy of the data on your phone. It opens at once, and still shows your fabrics with no signal.',
      'Your name is kept with each change, under **Settings** → **Recent changes**.',
    ],
    related: ['find', 'fabric', 'words'],
  },
  {
    id: 'find',
    title: 'Find a fabric',
    screen: 'fabrics',
    purpose: 'The Fabrics tab lists every quality, best earning first.',
    shot: 'fabrics.webp',
    steps: [
      'Tap **Fabrics** at the bottom.',
      'Type a quality or yarn in the search box, for example "crape" or "75D".',
      'Tap a unit name at the top to see only that unit\'s fabrics.',
      'Tap **Plain**, **Dobby**, **RFD** or **TPM × TPM** to narrow the list.',
      'Tap **Filters** for more choices, like price range or yarn used.',
      'Tap a fabric to open its page.',
    ],
    tips: [
      'The figure on the right is [[realisation]] per pick with [[VATAV]].',
      'Change the order from the first chip, for example to profit per pick.',
      'On a laptop, click a column heading to sort.',
      'Press / or Ctrl K (⌘ K on a Mac) to search the whole app. See **Search and keys**.',
      'The share button at the top saves the list as an Excel file.',
    ],
    related: ['fabric', 'ranking'],
  },
  {
    id: 'fabric',
    title: 'Read a fabric page',
    screen: 'fabric',
    purpose: 'One page per quality: what it is made of, what it costs and what it earns.',
    shot: 'fabric.webp',
    steps: [
      'Open a fabric from the Fabrics tab.',
      'Read the tiles at the top first. They hold the main figures.',
      'Tap a button under the title, like **Rates** or **Units**, to jump to that part.',
      '**Construction**, **Beam length** and **History** stay folded. Tap **Show** to open one; the app remembers your choice.',
      'Scroll to **Warp and weft** to see each yarn and its cost.',
      'Scroll to **Production centre** for metres and yarn per loom per day.',
      'Scroll to **Units · profit per pick** to compare units.',
    ],
    tips: [
      '**With VATAV** is realisation after the VATAV discount. This is the figure used everywhere.',
      '**Without VATAV** is the same figure before the discount.',
      '**Daily consumption** shows warp and weft kg one loom uses in a day.',
      '**TFO per side** shows how much yarn one TFO side twists in a day.',
      'Pick an older date under **Yarn rates** to see the fabric at past prices.',
      '**Sale rate history** lists every selling price with its date. Pick an older one under **View at** to see the fabric at it; nothing is saved.',
      'Delete a sale rate with its delete button. Delete the one in use and the next older rate comes back as the selling price.',
    ],
    how: [
      'Realisation per pick = (selling price − yarn cost with shortage − finishing cost) ÷ picks.',
      'Profit per pick = realisation per pick − the unit\'s cost per pick. It uses realisation with VATAV.',
      'Metres per loom per day = RPM × 1,440 × the unit\'s loom efficiency ÷ (PPI × 39.37) × panna. Double panna is used where two reed spaces fit the loom\'s reed width.',
      'A 280 cm loom uses the fabric\'s double panna RPM (the 280 cm RPM), even when it weaves a single panna. A 190 or 210 cm loom uses the single panna RPM. If the 280 cm RPM is blank, the 280 cm figures stay blank until it is set.',
      'Warp and weft kg per loom per day include shortage. The Production centre shows them per loom group; the unit cards show spindles for units with TFO.',
      'Loom realisation = realisation per pick with VATAV × metres per loom per day × PPI.',
    ],
    related: ['edit-fabric', 'temp-sale-rate', 'temp-rates', 'share'],
  },
  {
    id: 'edit-fabric',
    title: 'Add or change a fabric',
    screen: 'fabric-edit',
    purpose: 'Add a new quality, change one, or copy one for a new reed space.',
    shot: 'fabric-edit.webp',
    steps: [
      'To add one, tap **+** on the Fabrics tab.',
      'Type the quality name without the [[RS]], for example "Natural Crape".',
      'Fill in [[PPI]], [[reed]], reed space and the warp and weft yarns.',
      'Add the selling price under **Price and finishing**.',
      'Tap **Save**.',
      'To change a fabric, open it and tap **Edit**.',
    ],
    tips: [
      'Capitalise only the first letter of each word, like "Natural Crape".',
      'The app adds the RS to the name for you. RFD fabrics also get "(RFD)" at the end.',
      'For the same quality at a new RS, open it and tap **Duplicate for new RS**.',
      'Changing the price sets the sale date to today.',
      'Every new price is kept in the fabric\'s **Sale rate history**.',
      '[[Shortage]] starts at 10% on warp and weft unless you change it.',
      'Pick share splits picks between weft yarns, for example 1 and 1 for alternate picks. One weft yarn takes all picks. A blank share counts as 1, on the fabric page and in the Planner.',
      'VATAV is the discount off the selling price. Leave it blank if there is none.',
      'For RFD the selling price is per RFD metre.',
      'RFD shortage (shrinkage) grosses up yarn cost and processing.',
      'Transportation is per RFD metre. Brokering is taken on the full selling price.',
      'Beam length is in metres, per loom width of the units ticked.',
      'A dobby quality shows dobby looms only. Other qualities show one length per width, used for dobby looms too.',
      'On a laptop, Ctrl+S (⌘S on a Mac) saves the form.',
    ],
    related: ['fabric', 'yarns'],
  },
  {
    id: 'temp-rates',
    title: 'Try a different yarn rate',
    purpose: 'See what a fabric earns at another yarn price, without changing the master.',
    shot: 'temp-rates.webp',
    steps: [
      'Open a fabric and scroll to **Yarn rates**.',
      'Type a price in **Temporary rate** under the yarn.',
      'Every figure on the page changes at once.',
      'Tap **Reset** next to the rate to go back to the master rate.',
    ],
    tips: [
      'A temporary rate stays on this phone or laptop only. Others do not see it.',
      'It applies to every fabric that uses that yarn, until you reset it.',
      'An amber strip at the top reminds you while one is on.',
      'Tap **Save to master** in that strip to make it the real rate for everyone.',
      'Under its base yarn, a TPM yarn has a **Temporary TPM rate** line. It has two boxes: **Delta** and **Base rate**.',
      'The delta box changes this TPM yarn only. The base rate box changes the base yarn, so every yarn and fabric on it moves.',
      'The line shows base + delta = TPM rate, so you see what each part does.',
      'Save to master saves what you typed: the delta, the base rate, or both.',
      'It shows how many yarns and fabrics will change before you save.',
    ],
    related: ['fabric', 'yarns'],
  },
  {
    id: 'temp-sale-rate',
    title: 'Try a different sale rate',
    purpose: 'See what a fabric earns at another selling price, and save it if you like it.',
    steps: [
      'Open a fabric and scroll to **Try a sale rate**.',
      'Type a price, or tap **+₹1**, **−₹1**, **+₹0.25** or **−₹0.25**.',
      'Tap **No profit** to jump to the rate where profit is zero at the unit.',
      'Below, see realisation, profit and loom realisation, each against the master rate.',
      'Tap **Save to master** to make it the real selling price. The sale date is set to today.',
      'Or tap **Reset to master** to go back.',
    ],
    tips: [
      'A temporary sale rate stays on this phone or laptop only, for that fabric. Others do not see it.',
      'The fabric list, Ranking and the Planner use it too, until you reset it.',
      'An amber strip at the top reminds you while one is on.',
      'Files you share while it is on say a temporary sale rate was used.',
    ],
    related: ['fabric', 'temp-rates'],
  },
  {
    id: 'temp-rpm',
    title: 'Try a different loom RPM',
    purpose: 'See what a fabric makes and earns at another loom speed, and save it if you like it.',
    steps: [
      'Open a fabric and scroll to **Try a loom RPM**.',
      'Type a speed in **Single panna** (190 cm looms) or **Double panna** (280 cm looms), or both.',
      'Below, see metres per loom and loom realisation, each against the master RPM.',
      'Tap **Save to master** to make it the fabric\'s RPM for everyone. Only what you typed is saved.',
      'Or tap **Reset to master** to go back.',
    ],
    tips: [
      'A temporary RPM stays on this phone or laptop only, for that fabric. Others do not see it.',
      'It changes the loom figures on the fabric page, the fabric list and shared files.',
      'The Planner does not use it. It keeps its own RPM for each plan.',
      'An amber strip at the top reminds you while one is on.',
    ],
    related: ['fabric', 'temp-sale-rate'],
  },
  {
    id: 'search',
    title: 'Search and keys',
    purpose: 'Find any fabric, yarn, unit, screen or Guide page from one box.',
    steps: [
      'On a laptop, click the search box under the logo. On a phone, tap the search button at the top of a tab.',
      'Type part of a name, for example "crape 67" or "75D TPM".',
      'Tap a result, or use the arrow keys and press Enter.',
      'On a fabric page, the search also finds that page\'s parts, like **Construction** or **Costing**.',
    ],
    tips: [
      'With nothing typed, **Recent** shows the last 10 places you opened. **Favourites** shows the 5 you open most over 30 days.',
      'Favourites and Recent stay on this phone or laptop only.',
      'Start with "fabric " or "yarn " to search only fabrics or only yarns.',
      'Keys on a laptop: / or Ctrl K (⌘ K on a Mac) opens the search. 1 to 5 open the tabs.',
      'Press g then f to find a fabric, or g then y to find a yarn. Esc clears the box, then closes it.',
      'Ctrl+S (⌘S on a Mac) saves the form on screen.',
    ],
    related: ['find', 'start'],
  },
  {
    id: 'yarns',
    title: 'Yarns',
    screen: 'yarns',
    purpose: 'The list of every yarn and its rate. Fabrics pick their yarns from here.',
    shot: 'yarns.webp',
    steps: [
      'Tap **Yarns** at the bottom.',
      'Tap **+** to add a yarn.',
      'Choose **Base yarn** or **TPM yarn**.',
      'Type the name, count and rate. Only the name is required.',
      'Tap **Save**.',
    ],
    tips: [
      'A [[TPM yarn]] is made from a base yarn. Pick that base yarn when you add it.',
      'A TPM yarn costs its base yarn\'s rate plus the twisting charge (delta).',
      'A new rate keeps the old one, with its date, for history.',
      'A TPM yarn\'s count starts as its base yarn\'s. Type the twisted denier if it differs.',
      'A TPM yarn\'s page shows **Production per spindle and machine**. It gives kg per day for each unit and TFO type.',
      'A unit with a TFO division but no speed for the yarn is listed, blank.',
      'Tap **Used in fabrics** on a yarn page to list its fabrics. Tap a fabric to open it. A base yarn also lists fabrics that use its TPM yarns, marked **Through** with the TPM yarn\'s name.',
      'Tap a yarn under **TPM yarns made from it** to open that TPM yarn.',
    ],
    how: [
      'kg per spindle per day = RPM ÷ TPM × 1,440 minutes × efficiency × denier ÷ 9,000,000. The RPM is stored already × 2.',
      'kg per machine per day = kg per spindle × spindles per side × 2 sides. It is the same figure the spindle requirement uses.',
      'TPM yarn rate = base yarn rate + delta. The delta is ₹50 unless you change it on the yarn, so the TPM rate follows every base rate change.',
    ],
    related: ['temp-rates', 'units'],
  },
  {
    id: 'units',
    title: 'Units',
    screen: 'units',
    purpose: 'Each weaving unit, its looms, its cost per pick and its TFO machines.',
    shot: 'units.webp',
    steps: [
      'Tap **Units** at the bottom, then tap a unit.',
      'Tap **Edit** to change it.',
      'Set **Cost per pick** and **Loom efficiency**.',
      'Under **Loom groups**, tap **Add loom group** for each loom width and type.',
      'Enter the make, **Width cm**, number of **Looms** and the shedding.',
      'Turn on **TFO division** only if the unit has TFO machines.',
      'Tap **Save**.',
    ],
    tips: [
      'A unit needs loom groups before it shows in the Planner.',
      'Cost per pick is used to work out profit for every fabric in the unit.',
      'TFO speeds per yarn are added on the unit page, under **TFO speed table**.',
      'Each TFO type is a set of machines that runs at its own speed. Every machine has 2 sides; each side runs one yarn quality.',
      'Enter TFO RPM already multiplied by 2. The app does not double it.',
    ],
    how: [
      'TFO output per spindle per day = RPM ÷ TPM × 1,440 minutes × efficiency × denier ÷ 9,000,000 kg.',
      'Spindle requirement per loom = kg of each TPM yarn a loom uses per day ÷ output per spindle, for each TFO type, single and double panna. It uses the fabric\'s loom RPM and the unit\'s loom efficiency.',
    ],
    related: ['planner', 'words'],
  },
  {
    id: 'ranking',
    title: 'Ranking',
    screen: 'ranking',
    purpose: 'Every fabric in order of what it earns, as a bar chart.',
    shot: 'ranking.webp',
    steps: [
      'Tap **Ranking** at the bottom.',
      'Keep **Realisation · all** to rank by realisation per pick.',
      'Tap **Profit ·** and a unit name to rank by profit in that unit.',
      'Tap a fabric to open its page.',
    ],
    tips: [
      'Green means the fabric makes a profit in that unit. Red means a loss.',
      'Fabrics with no selling price are not ranked.',
    ],
    related: ['find', 'fabric'],
  },
  {
    id: 'planner',
    title: 'Planner',
    screen: 'planner',
    purpose: 'A plan shows how much yarn your looms use, and what they earn, in one normal day.',
    shot: 'planner.webp',
    steps: [
      'Tap **Planner**, then pick your unit at the top.',
      'In a loom group, tap **+ Add a quality** and choose the quality.',
      'Enter how many looms run it.',
      'Repeat for every quality on the floor.',
      'Check the tiles at the top: yarn used, realisation and profit.',
      'Tap **Save** and give the plan a date.',
    ],
    tips: [
      'RPM and efficiency fill in from the master. Change them in the plan if needed.',
      'A changed box turns lime green and shows **Reset** to go back.',
      'A red **Enter RPM** box means the fabric has no RPM yet. Type one in.',
      'Tap **Import sheet photo** to fill the plan from a photo of the daily planning sheet.',
      'Units with TFO machines also show TFO sides and the TPM yarn [[balance]].',
      'Tap **All units** to add up the latest saved plan of every unit.',
      'Turn off **Show revenue and ₹ figures** before showing the screen to others.',
    ],
    how: [
      'Metres per loom per day = RPM × 1,440 × efficiency ÷ (PPI × 39.37) × panna.',
      'Profit per loom per day = (realisation per pick − cost per pick) × metres × PPI.',
      'TFO kg per side per day = RPM ÷ TPM × 60 × denier ÷ 9,000 × efficiency × 24 × spindles ÷ 1,000.',
    ],
    related: ['units', 'share', 'trouble'],
  },
  {
    id: 'share',
    title: 'Share and export',
    purpose: 'Send a fabric or a plan as a PDF, an Excel file or a WhatsApp message.',
    shot: 'share.webp',
    steps: [
      'Open the fabric or plan you want to send.',
      'Tap the share button at the top.',
      'Choose **Basic** or **Detailed** at the top.',
      'Choose **PDF**, **Excel** or WhatsApp.',
      'Send it from the share screen of your phone.',
    ],
    tips: [
      '**Basic** has no ₹ figures at all. It is safe to send to anyone. It holds the key figures, construction and warp and weft only.',
      'With no greige width, GSM is worked out on reed space. It says so and reads low. Add the greige width for the real GSM.',
      '**Detailed** has every figure: yarn rates, the full cost breakdown, realisation, loom realisation and spindle figures.',
      'Its PDF and Excel also show the RPM and efficiency each figure assumes.',
      'Under **Detailed**, tap **Advanced** to switch off realisation, sale rate, yarn rates, costs or loom realisation. Each works on its own.',
      'Switch off **Unit-wise** to leave out every unit figure. That is unit cost and profit, loom RPM, looms, yarn-wise use, TFO, spindles and beam length.',
      'A part you switch off is left out of the file completely.',
      'With **Detailed**, WhatsApp and Copy text send the Basic text, plus the price when **Sale rate** is on.',
      'The share screen opens on **Basic** every time, so you always start with no ₹ figures.',
      'For plans, turn off **Include revenue (₹)** to send a copy with no money figures.',
      'Saved plans can be shared from **Saved plans** without opening them.',
      'File names start with the date, like 2026-10-29_plan_weavelon-2.',
    ],
    related: ['planner', 'fabric'],
  },
  {
    id: 'words',
    title: 'Words used in this app',
    purpose: 'Short meanings of the textile and money words in the app.',
    words: true,
    related: ['start'],
  },
  {
    id: 'trouble',
    title: 'Something looks wrong',
    screen: 'settings',
    purpose: 'Quick fixes for the common problems.',
    faq: [
      ['A box is red and says Enter RPM.', 'The fabric has no loom RPM for that width. Type the RPM in the plan, or add it to the fabric.'],
      ['Realisation shows ₹ —.', 'The fabric has no selling price, or a yarn has no rate. Add them on the fabric or yarn page.'],
      ['Profit shows ₹ —.', 'The unit has no cost per pick. Add it on the Units tab.'],
      ['I cannot see a change someone made.', 'Open **Settings** and tap **Reload from the Sheet**.'],
      ['It says No connection to your Google Sheet.', 'The app shows the copy saved on this phone, with the time it was last updated. Tap **Retry** when you have a signal. The app also tries again by itself when the signal comes back.'],
      ['The app still looks old after an update.', 'Close the app fully and open it again. Do this twice if needed.'],
      ['A unit is missing in the Planner.', 'It has no loom groups. Add them on the unit page.'],
      ['I lost my key.', 'Ask the owner to make you a new one in **Settings** → **People with access**.'],
    ],
    related: ['start', 'planner'],
  },
  {
    id: 'new',
    title: "What's new",
    purpose: 'What changed in each version, newest first.',
    news: true,
    related: ['start'],
  },
];

// One plain line per version. Add a line with every release.
export const WHATS_NEW = [
  ['1.34.0', 'Each fabric now keeps a sale rate history, like yarn rates. Find it under the temporary sale rate on a fabric page. Pick an older sale rate to see the fabric at it, or delete one: delete the rate in use and the next older one comes back.'],
  ['1.33.0', 'On a yarn page, tap Used in fabrics to see each fabric, then tap one to open it. A base yarn also lists fabrics that use its TPM yarns, with the TPM yarn named. Tap a TPM yarn to open it.'],
  ['1.32.0', 'The Construction section on a fabric page now shows GSM. With no greige width it shows GSM on reed space, labelled so.'],
  ['1.31.0', 'New look for the Basic and Detailed PDFs. Basic now has only the key figures, construction and warp and weft. GSM shows on reed space when there is no greige width. Detailed drops Picks per sale metre and has a sixth Advanced switch, Unit-wise.'],
  ['1.30.0', 'The Detailed Excel file is easier to read: ₹ per pick shows 3 decimals, other ₹ shows 2 decimals with commas, the top two rows stay in view, and it prints one page wide.'],
  ['1.29.0', 'Fabric share has two kinds again: Basic (no ₹) and Detailed. Includes ₹ is gone. Under Detailed, Advanced switches off realisation, sale rate, yarn rates, costs or loom realisation. In Detailed, spindle profitability sits under the TFO and spindles table. The Basic Excel file now ends in _spec.xlsx.'],
  ['1.28.0', 'Fabric share: Basic now has no ₹ figures at all. Choose Includes ₹ to add them. Advanced switches off realisation, sale rate, yarn rates or costs.'],
  ['1.27.0', 'One search for the whole app, with Favourites, Recent and keys (/ or Ctrl K, 1–5 for tabs). Jump buttons light up on a laptop too. A TPM yarn shows its kg per spindle and per machine at each unit. The temporary TPM rate is now two boxes, delta and base rate. Try a loom RPM on a fabric, then save it or reset it.'],
  ['1.26.2', 'The Planner now counts a blank weft pick share as 1, the same as the fabric page, so both show the same yarn kg and cost.'],
  ['1.26.1', '280 cm looms now use the fabric\'s double panna RPM (the 280 cm RPM) also when a wide fabric runs single panna, on the fabric page, Production centre and Detailed share. Where that RPM is blank, the 280 cm figures ask for it.'],
  ['1.26.0', 'New look across the app. The fabric page is shorter: jump buttons under the title, and Construction, Beam length and History fold away. The Planner shows four main figures first, with All figures for the rest. Boxes you can type in now look like boxes, and deleting asks in the app.'],
  ['1.25.0', 'Temporary rate on a TPM yarn: type it under the base yarn, and Save to master can change the delta, the base rate or both. Share a fabric as Basic or Detailed: the Detailed PDF and Excel carry every figure and how it is worked out.'],
  ['1.24.0', 'Faster: the app opens at once from the copy saved on your phone and loads in full only when something changed. With no signal it shows that copy. Cancel now asks before throwing away changes, long names wrap, and Planner tiles say when they cover only some looms.'],
  ['1.23.2', 'New app logo and icon: a stack of swatch cards with the Hanuman H.'],
  ['1.23.1', 'Production centre: removed the "all looms" figures, so it shows per loom per day only.'],
  ['1.23.0', 'Production centre now lists each warp and weft yarn with the kg a loom uses per day.'],
  ['1.22.0', 'Spindle requirement now shows how many spindles are for warp and how many for weft, under the total.'],
  ['1.21.0', 'Temporary sale rate: try another selling price on a fabric, see what changes, and save it to the master with today\'s date.'],
  ['1.20.0', 'The Planner works for every unit with loom groups. It shows profit, and All units adds up each unit\'s latest plan. New Guide, with a ? button on each screen.'],
  ['1.19.0', 'Temporary yarn rates: try another yarn price on this device only.'],
  ['1.18.0', 'The Planner can hide all ₹ figures, on screen and in shared files.'],
  ['1.15.0', 'First Planner: yarn used and TPM balance for one normal day.'],
];

// The word list. Keys are matched without case by [[term]] in the topics.
export const WORDS = [
  ['RS', 'Reed space. The width of the warp in the reed, in inches. Shown after the fabric name, like "Natural Crape 53".'],
  ['PPI', 'Picks per inch. How many weft threads go in one inch of fabric.'],
  ['Pick', 'One weft thread across the fabric. Money figures "per pick" are per metre for each pick per inch.'],
  ['Reed', 'The comb on the loom that spaces the warp threads. The number is dents per inch.'],
  ['Panna', 'One width of fabric. A double panna loom weaves two widths side by side.'],
  ['Denier', 'How thick a yarn is. Higher denier means a thicker, heavier yarn.'],
  ['TPM', 'Twists per metre. How tightly a yarn is twisted.'],
  ['TPM yarn', 'A yarn twisted on a TFO machine, made from a base yarn.'],
  ['TFO', 'Two-for-one twister. The machine that twists yarn. Each machine has 2 sides.'],
  ['TFO side', 'One half of a TFO machine. Each side twists one yarn at a time.'],
  ['Shortage', 'Yarn lost in weaving, as a percentage. It is added on top of the yarn used.'],
  ['Greige', 'Fabric straight off the loom, before dyeing or finishing.'],
  ['RFD', 'Ready for dyeing. Greige fabric after finishing, sold at a higher price.'],
  ['VATAV', 'The discount given to buyers on the selling price.'],
  ['Realisation', 'What a fabric earns after yarn and finishing costs, per pick.'],
  ['Profit per pick', 'Realisation per pick minus the unit\'s cost per pick.'],
  ['Cost per pick', 'What one pick costs to weave in a unit: power, wages and other running costs.'],
  ['RPM', 'Turns per minute. For a loom, picks per minute. For a TFO, spindle speed.'],
  ['Efficiency', 'The share of time a loom or TFO is actually running, as a percentage.'],
  ['Balance', 'TPM yarn made plus bought in, minus TPM yarn used. Below zero means short.'],
];

export const topicById = (id) => TOPICS.find((t) => t.id === id) || null;

// The topic a ? button on a screen opens.
export const SCREEN_TOPIC = Object.fromEntries(TOPICS.filter((t) => t.screen).map((t) => [t.screen, t.id]));

export function wordFor(term) {
  const k = String(term || '').toLowerCase();
  return WORDS.find(([w]) => w.toLowerCase() === k) || null;
}

// Plain text of a topic, for search.
export function topicText(t) {
  const parts = [t.title, t.purpose, ...(t.intro || []), ...(t.steps || []), ...(t.tips || []), ...(t.how || []), ...(t.faq || []).flat()];
  if (t.words) parts.push(...WORDS.flat());
  if (t.news) parts.push(...WHATS_NEW.flat());
  return parts.join(' ').replace(/\*\*|\[\[|\]\]/g, '');
}

export function searchTopics(q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return TOPICS;
  return TOPICS.filter((t) => {
    const text = topicText(t).toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
