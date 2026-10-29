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
      'On a laptop, click a column heading to sort. Press / to jump to search.',
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
    ],
    how: [
      'Realisation per pick = (selling price − yarn cost with shortage − finishing cost) ÷ picks.',
      'Profit per pick = realisation per pick − the unit\'s cost per pick.',
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
      '[[Shortage]] starts at 10% on warp and weft unless you change it.',
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
      'Choose **PDF**, **Excel** or WhatsApp.',
      'Send it from the share screen of your phone.',
    ],
    tips: [
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
