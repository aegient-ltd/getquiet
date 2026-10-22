# brand/

Interim Quiet Protect social images, made on 2026-10-22 (Quiet decision 534) from the
site's existing identity: the "Quiet." wordmark in DM Serif Display with the accent
full stop, the "q" mark from `favicon.svg`, and the palette in `css/style.css`.

They are a stopgap. The proper logo is an M4 roadmap item; when it lands, update
`make_brand.py` and regenerate.

This folder is excluded from the deployed site by `.assetsignore`. The one image the
site serves, the share card, is copied to `assets/social/`.

| File | Size | Used for |
|---|---|---|
| `social/quietprotect-profile-720.png` | 720 x 720 | Facebook Page profile picture (facebook.com/quietprotect) |
| `social/quietprotect-facebook-cover-1640x624.png` | 1640 x 624 | Facebook Page cover; text kept central because phones crop the sides |
| `social/quietprotect-linkedin-banner-1584x396.png` | 1584 x 396 | LinkedIn profile banner; text on the right, clear of the profile photo |
| `social/quietprotect-share-1200x630.png` | 1200 x 630 | Open Graph / social share card; served copy at `assets/social/` |

## Regenerating

1. Put the two Google Fonts files (SIL Open Font Licence) in `brand/fonts/`:
   - `DMSerifDisplay-Regular.ttf`
   - `DMSans[opsz,wght].ttf`

   Both are in the google/fonts repository on GitHub (`ofl/dmserifdisplay/` and `ofl/dmsans/`).
2. `python3 -m pip install pillow`
3. `python3 brand/make_brand.py` (writes into `brand/social/`)
4. If the share card changed, copy it to `assets/social/` and redeploy.

Reader copy on the images: UK English, no dashes.
