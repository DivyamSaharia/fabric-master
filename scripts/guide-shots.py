"""Screenshots for the Guide, taken from the demo build (sample data, no real prices).

Run after `npm run build:demo`:  python3 scripts/guide-shots.py
Writes public/guide/<topic>.webp at phone size (390 x 844 at 2x, saved as WebP), light mode.
Re-run whenever a screen changes. Needs Python Playwright with Chromium, and Pillow.
"""
import json
import pathlib
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEMO = ROOT / "dist-demo" / "index.html"
OUT = ROOT / "public" / "guide"

# A typical day at the demo's TFO unit, so the planner shot is not empty.
PLANNER = {
    "unitId": "u_2",
    "assignedOnly": False,
    "showMoney": True,
    "drafts": {
        "u_2": {
            "plan": {
                "unitId": "u_2",
                "looms": [
                    {"fabricId": "f_crepe", "groupId": "lg1", "looms": "12"},
                    {"fabricId": "f_vn", "groupId": "lg1", "looms": "8"},
                    {"fabricId": "f_moss", "groupId": "lg2", "looms": "20"},
                ],
                "sides": [{"yarnId": "y_tpm75", "typeId": "tt1", "sides": "6"}],
                "receipts": [],
                "settings": {},
                "soldAs": {},
            },
            "planId": None,
            "name": "",
            "date": "",
            "savedSig": "",
        }
    },
}

# topic file -> (hash route, scroll to this text first or None)
SHOTS = {
    "start.png": ("#/settings", None),
    "fabrics.png": ("#/fabrics", None),
    "fabric.png": ("#/fabric/f_crepe", None),
    "fabric-edit.png": ("#/fabric/f_crepe/edit", None),
    "temp-rates.png": ("#/fabric/f_crepe", "Yarn rates"),
    "yarns.png": ("#/yarns", None),
    "units.png": ("#/unit/u_2/edit", "Loom groups"),
    "ranking.png": ("#/ranking", None),
    "planner.png": ("#/planner", None),
    "share.png": ("#/planner", None),
}


def main():
    if not DEMO.exists():
        sys.exit("Build the demo first: npm run build:demo")
    OUT.mkdir(parents=True, exist_ok=True)
    url = DEMO.as_uri()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, color_scheme="light")
        page = ctx.new_page()
        page.goto(url + "#/fabrics")
        page.wait_for_selector(".fname", timeout=20000)
        # loom groups for the demo's other two units, so the planner shows its unit picker
        page.evaluate(
            """([plan]) => {
              localStorage.setItem('fm.guideHint.v1', 'true');
              localStorage.setItem('fm.planner.v1', JSON.stringify(plan));
              const d = JSON.parse(localStorage.getItem('fm.demo.v1'));
              if (d && d.LoomGroups && !d.LoomGroups.some((g) => g.unit_id === 'u_caj')) {
                d.LoomGroups.push({ id: 'lg_caj', unit_id: 'u_caj', make: 'Chinese', reed_width_cm: 190, shedding: 'Plain', looms: 32 });
                d.LoomGroups.push({ id: 'lg_wj', unit_id: 'u_wj', make: 'Waterjet', reed_width_cm: 190, shedding: 'Plain', looms: 48 });
                localStorage.setItem('fm.demo.v1', JSON.stringify(d));
              }
            }""",
            [PLANNER],
        )
        for name, (route, scroll_to) in SHOTS.items():
            page.goto(url + route)
            page.reload()
            page.wait_for_timeout(900)
            if name == "share.png":
                page.get_by_role("button", name="Share plan").click()
                page.wait_for_timeout(500)
            if scroll_to:
                page.get_by_text(scroll_to, exact=True).first.scroll_into_view_if_needed()
                page.evaluate("window.scrollBy(0, -120)")
                page.wait_for_timeout(400)
            path = OUT / name.replace(".png", ".webp")
            tmp = OUT / "_shot.png"
            page.screenshot(path=str(tmp))
            Image.open(tmp).convert("RGB").save(path, "WEBP", quality=72, method=6)
            tmp.unlink()
            print("saved", path.relative_to(ROOT), path.stat().st_size // 1024, "KB")
        browser.close()


if __name__ == "__main__":
    main()
