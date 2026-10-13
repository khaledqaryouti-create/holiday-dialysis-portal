# Sign-in page: Diaverum look (own version)

Same family as the company's other sign-in pages (green sign-in panel, blush brand side, logo, stacked tagline with
the last line bold orange, orange button), but deliberately **not a copy**:
| Company Billing / ESKA page | This portal |
|---|---|
| Form on the left, picture on the right | **Mirrored**: brand side on the left, form on the right |
| "Care / True care / For life / Life enhancing renal care" | Its own tagline: **Plan the trip / Keep the treatment / Holiday dialysis, arranged** (editable) |
| Doctor illustration | **Original trip drawing** (home clinic pin → plane → destination clinic pin, confirmed calendar), or your uploaded photo |
| Pink inputs, icons on the right | White inputs, icons on the left, show / hide password, **Clinic** list |
| Forgot password link | "Trouble signing in?" with your support phone / email, plus the security note |
| — | The 3 request steps under the tagline |

Previews: `preview-drawing.png`, `preview-photo.png`, `preview-phone.png`.

## Files
| File | |
|---|---|
| `frontend/src/components/LoginVisual.jsx` | **new**: brand side + the original drawing |
| `frontend/src/styles.css` | the sign-in CSS block is replaced: it now starts `/* Login — brand side`; also a preview block at the end |
| `frontend/src/pages/LoginPage.jsx` | **reference**: the new markup |
| `frontend/src/pages/BrandingPage.jsx` | "Tagline" box (one phrase per line); preview matches the new page |
| `backend/src/domain/branding.js`, `backend/src/services/branding.js` | tagline keeps line breaks (max 4 lines); new default tagline |
| `backend/test/unit/branding.test.js` | 1 new test |

## Paste into Cursor's Agent
Put the `login-v2-update` folder in your project root, then:
```
Apply the sign-in page design in login-v2-update (read login-v2-update/INSTALL.md, look at the preview PNGs).
1. Copy login-v2-update/frontend/src/components/LoginVisual.jsx as a new file.
2. In frontend/src/styles.css replace my current sign-in CSS block (the one starting "/* Login" up to, but not
   including, ".users{") with the block from login-v2-update/frontend/src/styles.css that starts
   "/* Login — brand side" and ends before ".users{". Also append the "/* Branding page preview of the sign-in page */"
   block from the end of that file.
3. Merge backend/src/domain/branding.js, backend/src/services/branding.js, backend/test/unit/branding.test.js and
   frontend/src/pages/BrandingPage.jsx into mine, keeping my own changes.
4. Rebuild MY frontend/src/pages/LoginPage.jsx with the layout of login-v2-update/frontend/src/pages/LoginPage.jsx:
   <div className="login2"> with <section className="login2-brand"><LoginVisual b={brand} /></section> and
   <section className="login2-form"> containing <div className="lf"> (lf-title, lf-sub, the form "lf-form",
   orange button "btn block lf-submit", "lf-trouble" line, "lf-note") and <footer className="lf-foot">.
   KEEP all my sign-in logic exactly: my fields (Email/User name, Password, Clinic), handlers, validation,
   clinic list and error messages. Only the markup and class names change.
5. Delete the login-v2-update folder, run npm test, then npm run dev and tell me the URL.
```
Then in **Admin Settings → Branding**: upload a logo with a **transparent background** (PNG or SVG) so it sits
directly on the blush colour. Change the **Tagline** if you like (one phrase per line, the last line is bold
orange). Optionally upload a sign-in picture to replace the drawing.
