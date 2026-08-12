# App Clip Code — research notes

The Apple code that inspired this project (concentric dashed arcs with a logo in
the middle) is an **App Clip Code**. It is not what this tool produces, and it
cannot be: the format is Apple's, closed, and generated only by Apple's own
tooling. These notes record why it was ruled out and what it would take if the
requirement ever changes.

## Why it was ruled out

| | Standard QR (this tool) | App Clip Code |
|---|---|---|
| Who can read it | iPhone, Android, desktop, POS scanners, any app | **only** iPhone/iPad camera and Apple's Code Scanner |
| Prerequisites | none | Apple Developer Program + a shipping iOS app + an App Clip |
| Destination | any URL | only an App Clip URL registered in App Store Connect |
| Centre artwork | your own logo | the App Clip badge — no custom logo |
| Colour | unrestricted | Apple-validated contrast pairs only |
| Cost | none | 99 USD/year plus app development |

For business cards, stickers, posters and menus, a standard QR wins on every
axis. An App Clip Code only makes sense for "hold your phone up and my app opens
instantly" — a physical venue with an install-free ordering flow, for example.

## If it is ever needed

1. **Apple Developer Program membership** (99 USD/year).
2. **An iOS app.** An App Clip cannot exist standalone; it is a target inside a
   parent app. Without an app this is an app-development project, not a design
   task.
3. **Add an App Clip target** in Xcode (File → New → Target → App Clip). App
   Clips have a hard download-size budget.
4. **Register the App Clip URL** in App Store Connect under App Clip
   Experiences. The code can only carry a URL defined there.
5. **Download the App Clip Code Generator** from developer.apple.com →
   Downloads (macOS command-line tool, membership required). Typical use:
   - `AppClipCodeGenerator generate --url <url> --index <n> --output code.svg`
   - `AppClipCodeGenerator suggest --foreground <colour> --background <colour>`
     to validate a colour pair Apple accepts.
6. **NFC**, if wanted: write the same URL to an NFC tag; the NFC-enabled variant
   can be both scanned and tapped.
7. **Test on a physical iPhone.** Code scanning cannot be tested in the
   simulator.

## Verify before acting

The above is based on Apple's general documentation and was not confirmed
line-by-line against the live docs (the pages render client-side). Re-check
before committing time:

- developer.apple.com/documentation/appclip — "Creating App Clip Codes"
- Current App Clip size limits and SDK requirements (as of 2026, new
  submissions must be built with Xcode 26 / the iOS 26 SDK)
- Whether the generator is still published under Downloads

## Getting the same look with a standard QR

These settings land closest to the reference App Store code while staying
universally scannable:

- Frame: **circle**, gap ~2.0, thickness ~0.8
- Modules: **circle** (Apple's own style) or **hexagon** (brand language)
- Finder patterns: **rounded**
- Colour: cobalt `#2563EB` or ink `#0C1B33` on white
- Logo: A·BASAR mark at 20–22%, hexagonal plate

The only real difference is that the interior is a square grid. Nobody notices
from a metre away — and everybody can scan it.
